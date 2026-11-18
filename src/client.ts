import { NoctHostError } from "./errors.js";
import type {
  Backup,
  Billing,
  CreateServerInput,
  CreateServersBulkInput,
  GpuFilters,
  OkResponse,
  ProvidersResponse,
  PublicDeployableResponse,
  PublicGpusResponse,
  RestoreBackupInput,
  RootPasswordResult,
  Server,
  User,
  WaitForActiveOptions,
} from "./types.js";
import { VERSION } from "./version.js";

export const DEFAULT_BASE_URL = "https://api.nocthost.com";
export const DEFAULT_PUBLIC_BASE_URL = "https://nocthost.com/api/public/v1";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface NoctHostOptions {
  /** Personal API key (nh_...). Falls back to the NOCTHOST_API_KEY environment variable. */
  apiKey?: string;
  /** Default https://api.nocthost.com */
  baseUrl?: string;
  /** Default https://nocthost.com/api/public/v1 */
  publicBaseUrl?: string;
  /** Per request timeout in milliseconds. Default 60000. */
  timeoutMs?: number;
  /** Automatic retries on 429 (any method) and on 502/503/504 or network errors (GET only). Default 2. */
  maxRetries?: number;
  /** Custom fetch implementation. Defaults to the global fetch (Node 18+, browsers, Deno, Bun). */
  fetch?: FetchLike;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean;
  publicApi?: boolean;
}

const FAILED_STATUSES = new Set(["ERROR", "DESTROYING", "DESTROYED"]);

function envApiKey(): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.NOCTHOST_API_KEY || undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new NoctHostError("Aborted", { status: 0, code: "aborted" }));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new NoctHostError("Aborted", { status: 0, code: "aborted" }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, (date - Date.now()) / 1000);
  return undefined;
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.error === "string") return b.error;
    if (typeof b.message === "string") return b.message;
  }
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 500);
  if (status === 401) return "Unauthorized: missing, expired or revoked API key";
  if (status === 429) return "Rate limited";
  return `HTTP ${status}`;
}

function seg(id: string): string {
  if (!id) throw new TypeError("id is required");
  return encodeURIComponent(id);
}

/** Servers: deploy, inspect, power and destroy. */
export class ServersResource {
  constructor(private readonly client: NoctHost) {}

  /** GET /servers: all non-destroyed servers. */
  async list(): Promise<Server[]> {
    const r = await this.client.request<{ servers: Server[] }>("/servers");
    return r.servers;
  }

  /** GET /servers/{id} */
  async get(id: string): Promise<Server> {
    const r = await this.client.request<{ server: Server }>(`/servers/${seg(id)}`);
    return r.server;
  }

  /** POST /servers: deploy one server. Returns at once with status PROVISIONING. */
  async create(input: CreateServerInput): Promise<Server> {
    const r = await this.client.request<{ server: Server }>("/servers", { method: "POST", body: input });
    return r.server;
  }

  /** POST /servers/bulk: deploy up to 10 identical servers. */
  async createBulk(input: CreateServersBulkInput): Promise<Server[]> {
    const r = await this.client.request<{ servers: Server[] }>("/servers/bulk", { method: "POST", body: input });
    return r.servers;
  }

  /** DELETE /servers/{id}: destroy a server. Billing stops the same hour. */
  destroy(id: string): Promise<OkResponse> {
    return this.client.request<OkResponse>(`/servers/${seg(id)}`, { method: "DELETE" });
  }

  /** GET /servers/providers: which backends take deploys now and which regions are out of capacity. */
  providers(): Promise<ProvidersResponse> {
    return this.client.request<ProvidersResponse>("/servers/providers");
  }

  /** POST /servers/{id}/reboot */
  reboot(id: string): Promise<Server> {
    return this.power(id, "reboot");
  }

  /** POST /servers/{id}/stop. A stopped server is still billed while it exists. */
  stop(id: string): Promise<Server> {
    return this.power(id, "stop");
  }

  /** POST /servers/{id}/start */
  start(id: string): Promise<Server> {
    return this.power(id, "start");
  }

  /** POST /servers/{id}/root-password: set a new root password without erasing the disk. */
  setRootPassword(id: string, password: string): Promise<RootPasswordResult> {
    return this.client.request<RootPasswordResult>(`/servers/${seg(id)}/root-password`, {
      method: "POST",
      body: { password },
    });
  }

  /**
   * Poll GET /servers/{id} until the server is ACTIVE and return it.
   * Throws NoctHostError with code "server_failed" if it ends up ERROR or is
   * being destroyed, and "wait_timeout" when timeoutMs passes.
   */
  async waitForActive(id: string, opts: WaitForActiveOptions = {}): Promise<Server> {
    const timeoutMs = opts.timeoutMs ?? 600_000;
    const intervalMs = opts.intervalMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (opts.signal?.aborted) throw new NoctHostError("Aborted", { status: 0, code: "aborted" });
      const server = await this.get(id);
      if (server.status === "ACTIVE") return server;
      if (FAILED_STATUSES.has(server.status)) {
        throw new NoctHostError(`Server ${id} is ${server.status}`, {
          status: 0,
          code: "server_failed",
          body: server,
        });
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new NoctHostError(
          `Server ${id} not ACTIVE after ${timeoutMs} ms (last status ${server.status})`,
          { status: 0, code: "wait_timeout", body: server },
        );
      }
      await sleep(Math.min(intervalMs, remaining), opts.signal);
    }
  }

  private async power(id: string, action: "reboot" | "stop" | "start"): Promise<Server> {
    const r = await this.client.request<{ server: Server }>(`/servers/${seg(id)}/${action}`, { method: "POST" });
    return r.server;
  }
}

/** Backups: full disk snapshots kept for 7 days. */
export class BackupsResource {
  constructor(private readonly client: NoctHost) {}

  /** GET /backups. Pass serverId to list the backups of one server. */
  async list(opts: { serverId?: string } = {}): Promise<Backup[]> {
    const r = await this.client.request<{ backups: Backup[] }>("/backups", {
      query: { serverId: opts.serverId },
    });
    return r.backups;
  }

  /** POST /backups: back up a server. Status goes PENDING, then AVAILABLE. */
  async create(serverId: string): Promise<Backup> {
    const r = await this.client.request<{ backup: Backup }>("/backups", {
      method: "POST",
      body: { serverId },
    });
    return r.backup;
  }

  /** POST /backups/{id}/restore: restore onto a new server (new IP). */
  async restore(id: string, input: RestoreBackupInput): Promise<Server> {
    const r = await this.client.request<{ server: Server }>(`/backups/${seg(id)}/restore`, {
      method: "POST",
      body: input,
    });
    return r.server;
  }

  /** DELETE /backups/{id} */
  delete(id: string): Promise<OkResponse> {
    return this.client.request<OkResponse>(`/backups/${seg(id)}`, { method: "DELETE" });
  }
}

/** Public catalog endpoints. No API key needed. */
export class PublicResource {
  constructor(private readonly client: NoctHost) {}

  /** GET /api/public/v1/deployable: live summary of clouds, cities, sizes and prices. */
  deployable(): Promise<PublicDeployableResponse> {
    return this.client.request<PublicDeployableResponse>("/deployable", { auth: false, publicApi: true });
  }

  /** GET /api/public/v1/gpus with optional filters. */
  gpus(filters: GpuFilters = {}): Promise<PublicGpusResponse> {
    return this.client.request<PublicGpusResponse>("/gpus", {
      auth: false,
      publicApi: true,
      query: { ...filters },
    });
  }
}

/** Client for the NoctHost REST API. */
export class NoctHost {
  readonly servers: ServersResource;
  readonly backups: BackupsResource;
  readonly billing: { get: () => Promise<Billing> };
  readonly public: PublicResource;

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly publicBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;
  private readonly extraHeaders: Record<string, string>;

  constructor(apiKeyOrOptions?: string | NoctHostOptions) {
    const opts: NoctHostOptions =
      typeof apiKeyOrOptions === "string" ? { apiKey: apiKeyOrOptions } : (apiKeyOrOptions ?? {});
    this.apiKey = opts.apiKey ?? envApiKey();
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.publicBaseUrl = (opts.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxRetries = Math.max(0, opts.maxRetries ?? 2);
    this.extraHeaders = { ...(opts.headers ?? {}) };
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) {
      throw new TypeError("No fetch implementation found. Use Node 18+ or pass options.fetch.");
    }
    this.fetchImpl = opts.fetch ? f : (input, init) => (globalThis.fetch as FetchLike)(input, init);

    this.servers = new ServersResource(this);
    this.backups = new BackupsResource(this);
    this.public = new PublicResource(this);
    this.billing = {
      get: () => this.request<Billing>("/billing"),
    };
  }

  /** GET /auth/me: id, email and balance of the key's owner. */
  async me(): Promise<User> {
    const r = await this.request<{ user: User }>("/auth/me");
    return r.user;
  }

  /** Shortcut for client.servers.waitForActive. */
  waitForActive(id: string, opts?: WaitForActiveOptions): Promise<Server> {
    return this.servers.waitForActive(id, opts);
  }

  /** Low level call. Path is relative to baseUrl (or publicBaseUrl when publicApi is set). */
  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = (opts.method ?? "GET").toUpperCase();
    const auth = opts.auth ?? true;
    if (auth && !this.apiKey) {
      throw new NoctHostError(
        "No API key. Pass one to new NoctHost(...) or set NOCTHOST_API_KEY.",
        { status: 0, code: "missing_api_key" },
      );
    }

    let url = (opts.publicApi ? this.publicBaseUrl : this.baseUrl) + path;
    if (opts.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `nocthost-js/${VERSION}`,
      ...this.extraHeaders,
    };
    if (auth) headers.Authorization = `Bearer ${this.apiKey}`;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    const idempotent = method === "GET" || method === "HEAD";

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        const timedOut = controller.signal.aborted;
        if (idempotent && attempt < this.maxRetries) {
          await sleep(this.backoff(attempt));
          continue;
        }
        throw new NoctHostError(
          timedOut ? `Request timed out after ${this.timeoutMs} ms` : `Network error: ${(err as Error)?.message ?? err}`,
          { status: 0, code: timedOut ? "timeout" : "network", cause: err },
        );
      }

      let text: string;
      try {
        text = await res.text();
      } finally {
        clearTimeout(timer);
      }
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      if (res.ok) return parsed as T;

      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const retryable =
        res.status === 429 || (idempotent && (res.status === 502 || res.status === 503 || res.status === 504));
      if (retryable && attempt < this.maxRetries) {
        await sleep(retryAfter !== undefined ? Math.min(retryAfter, 60) * 1000 : this.backoff(attempt));
        continue;
      }
      throw new NoctHostError(errorMessage(res.status, parsed), {
        status: res.status,
        code: "http",
        body: parsed,
        retryAfter,
      });
    }
  }

  private backoff(attempt: number): number {
    return Math.min(500 * 2 ** attempt, 8_000);
  }
}
