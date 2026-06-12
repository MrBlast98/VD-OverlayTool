Security & Deployment
=====================

1) Edge Function (recommended)
- Deploy the `supabase/functions/license-validate` function (Deno) and set environment variables in Supabase:
  - `SUPABASE_URL` - your Supabase project URL
  - `SUPABASE_SERVICE_ROLE_KEY` - service role key (server-only)

- In production, set `LICENSE_VALIDATE_ENDPOINT` (full function URL) so the app's main process uses that endpoint for validation.

2) Main process environment / store
- Do NOT embed `SUPABASE_SERVICE_ROLE` or any service_role key in renderer source.
- Set values as environment variables for your packaged app or write them to `electron-store` from an installer/secure admin action:
  - `supabase.url`
  - `supabase.service_role`
  - `SLUGBOT_API_KEY` or `LADDER_API_KEY` for the Slugbot ladder overlay

- The NeatQueue token is intentionally user-provided in the settings UI and stored locally; it is not hardwired into the app.
3) Local SQLite (optional)
- A local SQLite cache is scaffolded at `src/main/sqlite/db.js`. It uses `better-sqlite3` if installed. Install it on developer/machine environments if you want offline caching:

  npm install --save better-sqlite3

- The main process will initialize the cache in the user's `app.getPath('userData')/data/vd-overlay-tools.db` if `better-sqlite3` is available.

4) RLS and policies
- Enable Row Level Security on `license_keys` and follow the example policies in the code review or dashboard to prevent anon reads/writes. Keep destructive operations server-side only.

5) Renderer integrity
- Packaged builds now verify the renderer and preload hashes at startup.
- If `src/renderer/app.js` or `src/main/preload.js` is modified in a packaged build, the app opens in a blocked state and license/auth IPC returns an integrity error.

6) Packaging
- To build a Windows installer:

  npm run dist

If packaging fails due to native modules (e.g. `better-sqlite3`), install required build toolchains locally or omit the module and rely on remote validation.
