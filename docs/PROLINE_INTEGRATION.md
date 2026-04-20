# ProLine API and webhooks

Use this when wiring ProLine to the Elevated platform. **Do not commit API keys or webhook secrets**; keep them in `.env` (or your host’s secret store) only.

## Credentials (API key)

- In ProLine, copy the full **API Key** from **Integrations → ProLine API** (same credential [Zapier uses to connect](https://intercom.help/proline/en/articles/9396729-integrations-zapier)) and set `PROLINE_API_KEY` in [platform/.env.example](../platform/.env.example) → your real `.env`.
- That key is for **outbound** REST list/sync from this app. Set **`PROLINE_API_BASE_URL`** and **`PROLINE_API_PROJECTS_PATH`** to the list URL ProLine documents for your tenant (paths vary; Bubble-style APIs often look like `/api/1.1/obj/…`). Optional: `PROLINE_API_AUTH_STYLE` (`bearer` default, `token`, `x_api_key`), `PROLINE_API_PAGE_LIMIT`, `PROLINE_SYNC_DEFAULT_YEAR`.
- The inbound **webhook** path uses `PROLINE_WEBHOOK_SECRET` (shared secret you choose; ProLine may send it as a header or you append it to the URL—match whatever ProLine supports in the Webhooks tab).

## REST: pull projects into `Job` (bulk sync)

- **Guided connection test (UI):** as **Super Admin**, open **Dashboard → Settings** and use the **ProLine API assistant** card. It runs a read-only HTTP probe, explains errors (401, 404, wrong JSON shape), and suggests `.env` lines when the response matches a known list shape. Optional one-off fields are **not** saved to disk (merge with server `.env` for empty fields).
- **Bubble type scan (UI + API):** the assistant’s **“Scan common Bubble type names”** button (or `POST /api/integrations/proline/discover`) tries `GET /api/1.1/obj/<typename>` for a built-in list of guesses (`project`, `job`, …), per [Bubble Data API URLs](https://manual.bubble.io/core-resources/api/the-bubble-api/the-data-api/data-api-endpoints). Override candidates with env **`PROLINE_BUBBLE_TYPE_CANDIDATES`** (comma-separated).
- **Smoke test (no DB writes):** from the `platform` folder, `npm run proline:probe` — prints HTTP status, request URL, first page row count, and sample JSON keys.
- **Sync (writes DB):** while logged in as **Admin** or **Super Admin**, `POST /api/integrations/proline/sync-jobs` with JSON body, for example:
  - `{ "dryRun": true }` — fetches pages from ProLine only (no creates/updates; still validates env and HTTP).
  - `{ "dryRun": false, "maxPages": 50, "defaultYear": 2026 }` — upserts jobs by `prolineJobId`, allocates new `jobNumber`s for new rows, sets `sourceSheet` to `proline_api`, logs `JobEvent` types `PROLINE_API_SYNC_CREATE` / `PROLINE_API_SYNC_UPDATE`.
- **Offline parse check:** `npm run proline:selftest` — asserts Bubble-shaped `{ response: { results, remaining, cursor } }` pagination parsing.

If list requests return **401/404**, confirm with ProLine support that the Integrations API key is valid for **direct** HTTP (not only Zapier) and that **base URL + path** match their spec.

## Webhook URL

Point ProLine (or Zapier in the middle) at:

`https://<your-host>/api/webhooks/proline`

Use HTTPS in production. If ProLine offers “test” delivery, watch server logs and `JobEvent` rows for `source: "proline"`.

### Local testing (HTTPS tunnel)

ProLine’s servers cannot reach `http://localhost:3000`, so use a tunnel while developing:

1. From the `platform` folder, start the app: `npm run dev` (listens on **port 3000**).
2. In another terminal, from `platform`, run **`npm run tunnel:dev`** (same as `ngrok http 3000`). Install [ngrok](https://ngrok.com/download) and sign in (`ngrok config add-authtoken …`) if the tunnel command fails.
3. Copy the tunnel’s **HTTPS** forwarding URL (for example `https://abc123.ngrok-free.app`) and set ProLine’s webhook **URL** to:

   `https://<tunnel-host>/api/webhooks/proline`

   Example: `https://abc123.ngrok-free.app/api/webhooks/proline`

4. Optional sanity check: open that URL in a browser or `curl` it — a **GET** should return JSON like `ok: true` from the health handler.

Alternatives to ngrok include [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) (`cloudflared tunnel --url http://localhost:3000` once `cloudflared` is installed).

### Webhook secret (local and production)

If **`PROLINE_WEBHOOK_SECRET`** is set in `.env`, every **POST** must send the same value in a header:

- `x-proline-signature: <secret>` **or**
- `Authorization: Bearer <secret>`

If ProLine’s UI does not let you set custom headers, either clear `PROLINE_WEBHOOK_SECRET` for short-lived local testing only, or put Zapier (or another proxy) in front that adds the header. Without a matching header, the route returns **401 Unauthorized**.

## Webhook triggers in ProLine UI

ProLine’s **Create Webhook** dialog exposes these triggers:

| ProLine trigger | Typical use in Elevated |
|-----------------|-------------------------|
| **Project Created** | First-time project → allocate **job number**, create `Job`, link `prolineJobId`. |
| **Project Created or Updated** | Upsert: create if new, otherwise patch name/contract/status from ProLine. |
| **Quote Sent or Approved** | Update contract / selling basis (maps to `job.updated`). |
| **Invoice Sent or Paid** | Update **invoiced** totals and/or **paid** state (maps to `invoice` / `payment`). |

The HTTP handler accepts either the **legacy** `type` field (`job.signed`, `job.updated`, `invoice`, `payment`) or a **`trigger`** string that matches the labels above (case/spacing flexible). **Native ProLine project webhooks** often send flat fields such as `project_id`, `project_name`, `project_number`, `type` (job category like `Remodel`, not legacy routing), `approved_value` / `quoted_value`, `status`, and `assigned_to_id` / `assigned_to_name`; those are mapped to the internal upsert path automatically.

## ProLine user IDs → salesperson

ProLine lists **User ID** strings per person. Your `Salesperson` table uses short names (e.g. `Brett`, `James`). Set optional env **`PROLINE_USER_MAP`** (JSON object: ProLine user id → `Salesperson.name`):

```json
{
  "1726079008597x831408893393233500": "Adam",
  "1731083834581x693549038475885000": "Cale",
  "1731086745790x909955526121519800": "Chris",
  "1735853544702x169937761321604000": "Teddy",
  "1735913058048x196670778216192300": "Brett",
  "1735913165830x499495740739852160": "James"
}
```

Adjust values to match whatever you use in `Salesperson.name` (create missing names via admin or seed). If `salespersonName` is sent explicitly on the webhook body, it wins over this map.

## Example JSON bodies

**Project created (minimal):**

```json
{
  "trigger": "Project Created",
  "prolineJobId": "PROLINE_PROJECT_ID_HERE",
  "year": 2026,
  "name": "Customer — scope",
  "contractAmount": 12500,
  "prolineUserId": "1735913058048x196670778216192300"
}
```

**Invoice / paid (minimal):**

```json
{
  "trigger": "Invoice Sent or Paid",
  "prolineJobId": "PROLINE_PROJECT_ID_HERE",
  "invoicedDelta": 5000,
  "paidInFull": true,
  "paidDate": "2026-04-18T12:00:00.000Z"
}
```

When ProLine’s real payload shape differs, put **one** Zap step (or a tiny Cloud Function) that maps their fields into this shape until a native ProLine adapter is implemented.

## Security

- Rotate the API key if it was ever exposed in chat or screenshots.
- Use a long random `PROLINE_WEBHOOK_SECRET` and verify it on every request.
