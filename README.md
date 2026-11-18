# nocthost

Official JavaScript and TypeScript client for the [NoctHost](https://nocthost.com) API.
Deploy and manage hourly-billed cloud servers on major clouds such as Vultr, Hetzner,
Linode and OVHcloud from one account and one prepaid balance.

- Zero runtime dependencies, uses the global `fetch`
- ESM and CommonJS builds with bundled type definitions
- Node.js 18 or newer (also works in Bun, Deno and modern browsers)

Full API reference: https://nocthost.com/docs/api

## Install

```sh
npm install nocthost
```

## Quick start

Create a personal API key in the dashboard under Profile, API keys. It starts with `nh_`.
Keep it out of source control; the client also reads it from the `NOCTHOST_API_KEY`
environment variable.

```ts
import { NoctHost } from "nocthost";

const client = new NoctHost(process.env.NOCTHOST_API_KEY);

const { balance, hourlySpend } = await client.billing.get();
console.log(`Balance $${balance}, spending $${hourlySpend}/h`);

const server = await client.servers.create({
  label: "my-bot",
  planId: "vc2-1c-1gb",
  regionId: "ams",
  providerId: "vultr",
  password: process.env.ROOT_PASSWORD!,
});

const ready = await client.waitForActive(server.id, { timeoutMs: 10 * 60_000 });
console.log(`ssh root@${ready.ipv4}`);
```

CommonJS works the same way:

```js
const { NoctHost } = require("nocthost");
```

## Configuration

```ts
const client = new NoctHost({
  apiKey: "nh_...",            // default: process.env.NOCTHOST_API_KEY
  baseUrl: "https://api.nocthost.com",
  publicBaseUrl: "https://nocthost.com/api/public/v1",
  timeoutMs: 60_000,           // per request
  maxRetries: 2,               // 429 on any method; 502/503/504 and network errors on GET only
  fetch: customFetch,          // optional fetch implementation
  headers: { "X-Trace": "1" }, // extra headers on every request
});
```

`new NoctHost("nh_...")` is a shortcut for `new NoctHost({ apiKey: "nh_..." })`.

## Methods

Money and prices are decimal strings in USD (`"9.96"`), exactly as the API returns them.
Methods unwrap the response envelope: `servers.list()` returns the array, not `{ servers }`.

### Account

| Method | HTTP | Returns |
| --- | --- | --- |
| `client.me()` | `GET /auth/me` | `User`: `id`, `email`, `balance` |
| `client.billing.get()` | `GET /billing` | `Billing`: `balance`, `hourlySpend` |

### Servers

| Method | HTTP | Returns |
| --- | --- | --- |
| `client.servers.list()` | `GET /servers` | `Server[]` (all non-destroyed) |
| `client.servers.get(id)` | `GET /servers/{id}` | `Server` |
| `client.servers.create(input)` | `POST /servers` | `Server` with status `PROVISIONING` |
| `client.servers.createBulk(input)` | `POST /servers/bulk` | `Server[]`, up to 10 |
| `client.servers.destroy(id)` | `DELETE /servers/{id}` | `{ ok: true }` |
| `client.servers.providers()` | `GET /servers/providers` | `{ providers, outages }` |
| `client.servers.reboot(id)` | `POST /servers/{id}/reboot` | `Server` |
| `client.servers.stop(id)` | `POST /servers/{id}/stop` | `Server` |
| `client.servers.start(id)` | `POST /servers/{id}/start` | `Server` |
| `client.servers.setRootPassword(id, password)` | `POST /servers/{id}/root-password` | `{ password, matchesRequested, note }` |
| `client.servers.waitForActive(id, opts)` | polls `GET /servers/{id}` | `Server` once `ACTIVE` |

`client.waitForActive(id, opts)` is the same helper on the client itself.

`create` input:

```ts
{
  label: "my-bot",            // Latin letters, digits, dot, dash, underscore
  planId: "vc2-1c-1gb",
  regionId: "ams",
  providerId: "vultr",        // optional, see servers.providers()
  osId: 1743,                 // optional, default Ubuntu 22.04; or appSlug, not both
  password: "...",            // 12-72 Latin chars, 3 of lower/upper/digits/symbols, no spaces
  sshKey: "ssh-ed25519 AAAA... you@host", // optional
  billingCycle: "monthly",    // optional, default hourly
  expectedMonthlyUsd: 10,     // required with monthly on regular sizes
}
```

`createBulk` takes the same fields plus `count` (1 to 10). Labels get `-1..-N` suffixes.

Deploys are asynchronous. Check `servers.providers()` before picking a provider and
region, then poll with `waitForActive`. It checks every 5 seconds by default and throws a
`NoctHostError` with code `server_failed` if the server lands in `ERROR` or is being
destroyed, or `wait_timeout` after `timeoutMs` (default 10 minutes). Pass `intervalMs`
or an `AbortSignal` as `signal` to tune it.

Server statuses: `PROVISIONING`, `ACTIVE`, `STOPPED`, `SUSPENDED`, `ARCHIVED`,
`DESTROYING`, `DESTROYED`, `ERROR`. A stopped server is still billed while it exists.

### Backups

Full disk snapshots, kept for 7 days.

| Method | HTTP | Returns |
| --- | --- | --- |
| `client.backups.list({ serverId? })` | `GET /backups` | `Backup[]` |
| `client.backups.create(serverId)` | `POST /backups` | `Backup` with status `PENDING` |
| `client.backups.restore(id, { password, planId? })` | `POST /backups/{id}/restore` | new `Server` (new IP) |
| `client.backups.delete(id)` | `DELETE /backups/{id}` | `{ ok: true }` |

### Public catalog (no API key)

| Method | HTTP | Returns |
| --- | --- | --- |
| `client.public.deployable()` | `GET https://nocthost.com/api/public/v1/deployable` | clouds, cities, sizes and prices available now |
| `client.public.gpus(filters?)` | `GET https://nocthost.com/api/public/v1/gpus` | GPU offers |

`gpus` filters: `gpu_model`, `min_vram_gb`, `continent`, `max_hourly_usd`, `cloud`.

```ts
const pub = new NoctHost(); // no key needed for these two
const { offers } = await pub.public.gpus({ gpu_model: "L40S", continent: "Europe" });
```

### Low level

`client.request(path, { method, body, query })` calls any other endpoint from the
[API reference](https://nocthost.com/docs/api) with the same auth, retries and errors.

## Errors

Every failure throws `NoctHostError`:

```ts
import { NoctHost, NoctHostError } from "nocthost";

try {
  await client.servers.get("does-not-exist");
} catch (err) {
  if (err instanceof NoctHostError) {
    console.log(err.status);     // HTTP status, 0 if no response
    console.log(err.code);       // "http", "network", "timeout", "wait_timeout", "server_failed", "aborted", "missing_api_key"
    console.log(err.message);    // the API's error text when it sent one
    console.log(err.body);       // parsed error body
    console.log(err.retryAfter); // seconds, from Retry-After
  }
}
```

- `401`: missing, expired or revoked key
- `429`: rate limited (300 requests per minute per key). The client retries with backoff
  before throwing.

## Links

- Website: https://nocthost.com
- API docs: https://nocthost.com/docs/api
- OpenAPI spec: https://nocthost.com/openapi.json

## License

MIT, see [LICENSE](./LICENSE).
