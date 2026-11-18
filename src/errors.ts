export interface NoctHostErrorOptions {
  status: number;
  code?: string;
  body?: unknown;
  retryAfter?: number;
  cause?: unknown;
}

/**
 * Thrown for any failed call.
 *
 * - `status` is the HTTP status (401 bad or revoked key, 429 rate limited, ...),
 *   or 0 when no HTTP response was received or a helper such as
 *   `waitForActive` gave up.
 * - `code` is a short machine readable reason: "http", "network", "timeout",
 *   "wait_timeout", "server_failed", "aborted" or "missing_api_key".
 * - `body` is the parsed JSON error body when the API sent one.
 */
export class NoctHostError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;
  /** Seconds from the Retry-After header, when present. */
  readonly retryAfter: number | undefined;

  constructor(message: string, opts: NoctHostErrorOptions) {
    super(message);
    this.name = "NoctHostError";
    this.status = opts.status;
    this.code = opts.code ?? (opts.status ? "http" : "network");
    this.body = opts.body;
    this.retryAfter = opts.retryAfter;
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}
