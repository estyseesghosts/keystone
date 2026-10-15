// Typed request helper for the Pinetree Misskey-compatible API.
// POST JSON to /api/${endpoint}; auth via the `i` body field.

export const TOKEN_KEY = "pinetree_token";

interface ApiErrorBody {
  error?: { message?: string; code?: string; kind?: string };
}

export class ApiError extends Error {
  status: number;
  code?: string;
  kind?: string;

  constructor(message: string, status: number, code?: string, kind?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable (private mode, etc.): session simply won't persist.
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore.
  }
}

export async function apiCall<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const token = getToken();
  const body = token ? { ...params, i: params.i ?? token } : params;
  let response: Response;
  try {
    response = await fetch(`/api/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Could not reach the server (${err instanceof Error ? err.message : "network error"}). Is it running?`,
    );
  }

  // Successful writes may return 204 No Content: read text first, never
  // blind response.json().
  const raw = response.status === 204 ? "" : await response.text();
  let payload: unknown;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new ApiError(`API returned invalid JSON (HTTP ${response.status})`, response.status);
    }
  }

  if (!response.ok) {
    const apiError = payload as ApiErrorBody | undefined;
    throw new ApiError(
      apiError?.error?.message ?? `API error: HTTP ${response.status}`,
      response.status,
      apiError?.error?.code,
      apiError?.error?.kind,
    );
  }

  return payload as T; // Use T = undefined for successful 204 endpoints.
}
