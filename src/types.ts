/** Lifecycle status of a server. */
export type ServerStatus =
  | "PROVISIONING"
  | "ACTIVE"
  | "STOPPED"
  | "SUSPENDED"
  | "ARCHIVED"
  | "DESTROYING"
  | "DESTROYED"
  | "ERROR";

/** Lifecycle status of a backup. */
export type BackupStatus = "PENDING" | "AVAILABLE" | "EXPIRED" | (string & {});

/** Provider id accepted as `providerId`, for example "vultr", "hetzner", "linode". */
export type ProviderId = string;

export interface User {
  id: string;
  email: string;
  /** Prepaid balance in USD, as a decimal string ("9.96"). */
  balance: string;
  [key: string]: unknown;
}

export interface Billing {
  /** Prepaid balance in USD, as a decimal string. */
  balance: string;
  /** Total hourly spend of all running servers in USD, as a decimal string. */
  hourlySpend: string;
  [key: string]: unknown;
}

export interface Server {
  id: string;
  label: string;
  status: ServerStatus;
  provider?: string;
  region: string;
  plan: string;
  /** Human readable OS or app name, for example "Ubuntu 22.04 LTS". */
  image?: string;
  ipv4: string | null;
  ipv6?: string | null;
  /** Hourly price in USD, as a decimal string. */
  hourlyPrice: string;
  accessType?: "ssh" | "rdp";
  failureReason?: string | null;
  billingCycle?: "hourly" | "monthly" | (string & {});
  monthlyPrice?: string;
  paidUntil?: string | null;
  createdAt: string;
  [key: string]: unknown;
}

export interface CreateServerInput {
  /** Latin letters, digits, dot, dash and underscore, up to 64 chars. */
  label: string;
  planId: string;
  regionId: string;
  providerId?: ProviderId;
  /** OS image id from the catalog. Default is Ubuntu 22.04. Mutually exclusive with appSlug. */
  osId?: number;
  /** One-click app (Vultr only). Mutually exclusive with osId. */
  appSlug?: string;
  /** Root password: 12-72 Latin chars, at least three of lower/upper/digits/symbols, no spaces. */
  password: string;
  /** Public SSH key installed for root at first boot. */
  sshKey?: string;
  /** Default "hourly". See the API docs for monthly prepaid rules. */
  billingCycle?: "hourly" | "monthly";
  /** Required with billingCycle "monthly" on regular sizes: the monthly price you were shown. */
  expectedMonthlyUsd?: number;
  [key: string]: unknown;
}

export interface CreateServersBulkInput extends CreateServerInput {
  /** 1 to 10. Labels get -1..-N suffixes. */
  count: number;
}

export interface Provider {
  id: ProviderId;
  label?: string;
  available: boolean;
  [key: string]: unknown;
}

export interface ProvidersResponse {
  providers: Provider[];
  /** providerId -> regionId -> human readable note, for regions temporarily out of capacity. */
  outages?: Record<string, Record<string, string>>;
  [key: string]: unknown;
}

export interface RootPasswordResult {
  /** The password now set on the server. Shown only in this response. */
  password: string;
  /** false when the provider generated its own password instead of the requested one. */
  matchesRequested: boolean;
  note?: string;
  [key: string]: unknown;
}

export interface Backup {
  id: string;
  label: string;
  status: BackupStatus;
  region: string;
  plan: string;
  provider?: string;
  serverId?: string | null;
  createdAt: string;
  expiresAt: string;
  [key: string]: unknown;
}

export interface RestoreBackupInput {
  /** Root password of the restored server. */
  password: string;
  /** Optional bigger plan to restore onto. */
  planId?: string;
}

export interface OkResponse {
  ok: boolean;
  [key: string]: unknown;
}

export interface WaitForActiveOptions {
  /** Give up after this many milliseconds. Default 600000 (10 minutes). */
  timeoutMs?: number;
  /** Delay between polls. Default 5000. */
  intervalMs?: number;
  /** Abort the wait early. */
  signal?: AbortSignal;
}

/** Filters for the public GPU list. */
export interface GpuFilters {
  gpu_model?: string;
  min_vram_gb?: number;
  continent?: string;
  max_hourly_usd?: number;
  cloud?: string;
}

export interface PublicGpuRegion {
  id: string;
  city: string;
  continent: string;
  price_per_hour_usd: number;
  price_per_month_usd: number;
  [key: string]: unknown;
}

export interface PublicGpuOffer {
  id: string;
  cloud: string;
  gpu_model: string;
  gpu_count: number | null;
  fractional: boolean;
  vram_gb_per_gpu: number | null;
  vram_gb_total: number;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  price_per_hour_usd: number;
  price_per_month_usd: number;
  price_per_month_prepaid_usd?: number;
  regions: PublicGpuRegion[];
  [key: string]: unknown;
}

export interface PublicGpusResponse {
  generated_at: string;
  currency: string;
  offer_count: number;
  offers: PublicGpuOffer[];
  [key: string]: unknown;
}

/** Live summary of everything that can be deployed right now. */
export interface PublicDeployableResponse {
  generated_at: string;
  currency: string;
  totals: Record<string, unknown>;
  categories: Array<Record<string, unknown>>;
  clouds: Array<Record<string, unknown>>;
  locations: Array<Record<string, unknown>>;
  gpus: Array<Record<string, unknown>>;
  [key: string]: unknown;
}
