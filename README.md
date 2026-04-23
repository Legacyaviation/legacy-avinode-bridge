# PMG Avinode Bridge

Webhook-triggered service that sends Avinode RFQs when an Airtable record's `Status` flips to `Send to Avinode`. Uses Playwright to drive the Avinode embed as a logged-in human would.

## Architecture

```
Airtable record.Status = "Send to Avinode"
     ↓ (Airtable Automation → "Send a webhook")
POST https://<service>/fire  { "recordId": "rec..." }
     ↓ (shared-secret header check)
Render service (Node + Express + Playwright + Chromium)
     ↓ GET record from Airtable
     ↓ Drive Avinode embed in headless Chromium
     ↓ Click Inquire → fill contact → Send inquiry
     ↓ PATCH Airtable: Status = "Sent" (or "Error")
```

## Local dev

```bash
npm install
cp .env.example .env           # fill in secrets
node server.js                 # listens on :3000
# in another terminal:
curl -X POST http://localhost:3000/fire \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -d '{"recordId":"rec..."}'
```

## Deploy to Render

1. Push this repo to GitHub (private).
2. On render.com → New → Web Service → connect the GitHub repo.
3. Runtime: **Docker** (auto-detected from `Dockerfile`).
4. Plan: **Starter ($7/mo)** — the free tier sleeps and will cold-start on every webhook.
5. Add environment variables from `.env.example` (use real values).
6. Deploy. After build completes, note your service URL (e.g. `https://pmg-avinode.onrender.com`).

## Wire Airtable automation

In Airtable → Automations → Create automation:

1. **Trigger**: When record matches conditions → `Status` is `Send to Avinode`
2. **Action**: Send a webhook
   - URL: `https://<your-render-url>/fire`
   - Method: POST
   - Headers: `X-Webhook-Secret: <same value as WEBHOOK_SECRET env var>`
   - Body: `{ "recordId": "{{Record ID}}" }`
3. Turn the automation ON.

## What records it expects

The webhook handler reads these fields from the Airtable record:

| Field name           | Type               | Purpose                       |
| -------------------- | ------------------ | ----------------------------- |
| `Departure Airport`  | text (ICAO code)   | e.g. `KTEB`                   |
| `Arrival Airport`    | text (ICAO code)   | e.g. `KBCT`                   |
| `Departure Date/Time`| date               | YYYY-MM-DD used               |
| `Pax Count`          | number             | passenger count               |
| `Client`             | text               | contact name on RFQ           |
| `Contact Email`      | email              | RFQ contact email             |
| `Contact Phone`      | phone              | RFQ contact phone             |
| `Trip Notes`         | long text          | RFQ message                   |
| `Status`             | single-select      | written back: `Sent` / `Error`|

## Notes

- One Avinode RFQ = one `Inquire` click = one operator. Set `INQUIRE_ALL=true` to fan out to every aircraft class returned.
- Avinode's confirmation UI does not show a trip/reference number, so the service writes only `Status = Sent`. Trip refs arrive via email to the address in the RFQ.
- Duplicate inquiries are expected and supported — no dedup logic.
- If Avinode changes their embed markup, selectors in `fire.js` may break. The symptoms will appear in Render logs as errors like `no airport suggestions` or `no Inquire buttons after Search`.
