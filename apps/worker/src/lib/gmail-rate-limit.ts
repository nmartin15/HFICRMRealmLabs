import { GMAIL_QUOTA_PAUSED_MESSAGE } from "@realm-labs/contracts";

export const GMAIL_MIN_INTERVAL_MS = 250;
export const GMAIL_QUOTA_RETRY_MS = 60_000;
export const GMAIL_MAX_QUOTA_WAITS = 3;

export class GmailQuotaPausedError extends Error {
  constructor() {
    super(GMAIL_QUOTA_PAUSED_MESSAGE);
    this.name = "GmailQuotaPausedError";
  }
}

export type GmailQuotaBudget = {
  waits: number;
  maxWaits: number;
};

export function createGmailQuotaBudget(
  maxWaits = GMAIL_MAX_QUOTA_WAITS,
): GmailQuotaBudget {
  return { waits: 0, maxWaits };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function gaxiosErrorPayload(err: unknown): Record<string, unknown> | null {
  const root = asRecord(err);
  if (!root) {
    return null;
  }
  const response = asRecord(root.response);
  const data = response ? asRecord(response.data) : null;
  const nested = data ? asRecord(data.error) : null;
  return nested ?? data;
}

function errorMessage(err: unknown): string {
  const root = asRecord(err);
  if (root && typeof root.message === "string" && root.message.trim()) {
    const top = root.message.trim();
    if (!/^request failed with status code \d+/i.test(top)) {
      return top;
    }
  }
  const payload = gaxiosErrorPayload(err);
  if (payload && typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  if (root && typeof root.message === "string") {
    return root.message;
  }
  return "";
}

function errorStatus(err: unknown): number {
  const root = asRecord(err);
  if (!root) {
    return Number.NaN;
  }
  for (const candidate of [root.status, root.code]) {
    const status = Number(candidate);
    if (Number.isFinite(status) && status > 0) {
      return status;
    }
  }
  const response = asRecord(root.response);
  if (response) {
    const status = Number(response.status);
    if (Number.isFinite(status) && status > 0) {
      return status;
    }
  }
  const payload = gaxiosErrorPayload(err);
  if (payload) {
    const status = Number(payload.code);
    if (Number.isFinite(status) && status > 0) {
      return status;
    }
  }
  return Number.NaN;
}

function collectReasons(value: unknown): string[] {
  const record = asRecord(value);
  if (!record || !("errors" in record) || !Array.isArray(record.errors)) {
    return [];
  }
  return record.errors.flatMap((item) => {
    const row = asRecord(item);
    return row && typeof row.reason === "string" ? [row.reason] : [];
  });
}

function errorReasons(err: unknown): string[] {
  return [...collectReasons(err), ...collectReasons(gaxiosErrorPayload(err))];
}

export function isMissingGmailEntity(err: unknown): boolean {
  const status = errorStatus(err);
  const message = errorMessage(err).toLowerCase();
  const reasons = errorReasons(err);
  if (status === 404) {
    return true;
  }
  return (
    reasons.includes("notFound") ||
    message.includes("requested entity was not found")
  );
}

export function isGmailRateLimit(err: unknown): boolean {
  const status = errorStatus(err);
  const message = errorMessage(err).toLowerCase();
  const reasons = errorReasons(err);
  if (status === 429) {
    return true;
  }
  if (
    reasons.includes("rateLimitExceeded") ||
    reasons.includes("userRateLimitExceeded")
  ) {
    return true;
  }
  return (
    status === 403 &&
    (message.includes("quota exceeded") || message.includes("rate limit"))
  );
}

export function gmailRetryDelayMs(err: unknown): number {
  if (!err || typeof err !== "object" || !("response" in err)) {
    return GMAIL_QUOTA_RETRY_MS;
  }
  const response = err.response;
  if (!response || typeof response !== "object" || !("headers" in response)) {
    return GMAIL_QUOTA_RETRY_MS;
  }
  const headers = response.headers;
  if (!headers || typeof headers !== "object" || !("retry-after" in headers)) {
    return GMAIL_QUOTA_RETRY_MS;
  }
  const raw = headers["retry-after"];
  const seconds = typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return GMAIL_QUOTA_RETRY_MS;
  }
  return Math.min(Math.ceil(seconds * 1000), 5 * 60 * 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

let nextAllowedAt = 0;

export async function paceGmailCall(): Promise<void> {
  const wait = nextAllowedAt - Date.now();
  if (wait > 0) {
    await sleep(wait);
  }
  nextAllowedAt = Date.now() + GMAIL_MIN_INTERVAL_MS;
}

export async function callGmail<T>(
  fn: () => Promise<T>,
  budget: GmailQuotaBudget,
): Promise<T> {
  for (;;) {
    await paceGmailCall();
    try {
      return await fn();
    } catch (err) {
      if (!isGmailRateLimit(err)) {
        throw err;
      }
      if (budget.waits >= budget.maxWaits) {
        throw new GmailQuotaPausedError();
      }
      budget.waits += 1;
      await sleep(gmailRetryDelayMs(err));
    }
  }
}
