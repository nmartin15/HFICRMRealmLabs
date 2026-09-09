export const GMAIL_MIN_INTERVAL_MS = 250;
export const GMAIL_QUOTA_RETRY_MS = 60_000;
export const GMAIL_MAX_QUOTA_WAITS = 3;

export class GmailQuotaPausedError extends Error {
  constructor() {
    super("Gmail quota paused; next sync will continue");
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

function errorMessage(err: unknown): string {
  if (!err || typeof err !== "object") {
    return "";
  }
  return "message" in err && typeof err.message === "string" ? err.message : "";
}

function errorStatus(err: unknown): number {
  if (!err || typeof err !== "object") {
    return Number.NaN;
  }
  if ("status" in err) {
    return Number(err.status);
  }
  if ("code" in err) {
    return Number(err.code);
  }
  return Number.NaN;
}

function errorReasons(err: unknown): string[] {
  if (!err || typeof err !== "object" || !("errors" in err)) {
    return [];
  }
  const { errors } = err;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.flatMap((item) => {
    if (!item || typeof item !== "object" || !("reason" in item)) {
      return [];
    }
    return typeof item.reason === "string" ? [item.reason] : [];
  });
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
