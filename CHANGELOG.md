# Changelog

## 0.1.0 (2026-11-18)

First release.

- `NoctHost` client with API key auth (`nh_...` or `NOCTHOST_API_KEY`)
- Account: `me()`, `billing.get()`
- Servers: `list`, `get`, `create`, `createBulk`, `destroy`, `providers`, `reboot`, `stop`, `start`, `setRootPassword`
- `waitForActive(id, { timeoutMs, intervalMs, signal })` polling helper
- Backups: `list`, `create`, `restore`, `delete`
- Public catalog without a key: `public.deployable()`, `public.gpus(filters)`
- `NoctHostError` with `status`, `code`, `body`, `retryAfter`
- Automatic retries on 429 (all methods) and on 502/503/504 or network errors (GET only)
- ESM and CommonJS builds with type definitions, no runtime dependencies
