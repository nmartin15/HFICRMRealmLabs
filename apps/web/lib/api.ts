import {
  apiErrorResponseSchema,
  type ApiErrorResponse,
} from "@realm-labs/contracts";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (
    init?.body &&
    !headers.has("Content-Type") &&
    !(init.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    const json: unknown = await res.json().catch(() => null);
    const parsed = apiErrorResponseSchema.safeParse(json);
    const error: ApiErrorResponse | undefined = parsed.success
      ? parsed.data
      : undefined;
    throw new ApiError(
      res.status,
      error?.error.code ?? "ERROR",
      error?.error.message ?? res.statusText,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}
