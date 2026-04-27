// Webhook-triggered Avinode quote sender.
// Airtable automation fires POST /fire { recordId } — this service fetches the
// record, drives the Avinode embed via Playwright, and PATCHes status back.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { fireQuote } = require('./fire');

const {
  PORT = 3000,
  WEBHOOK_SECRET,
  AIRTABLE_PAT,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_ID,
  AVINODE_TOKEN,
  INQUIRE_ALL = 'false',
  DEFAULT_CONTACT_NAME = 'Legacy Aviation',
  DEFAULT_CONTACT_EMAIL = 'flight-ops@legacyaviationgroup.com',
  DEFAULT_CONTACT_PHONE = '+1 646 801 5387',
} = process.env;

for (const [k, v] of Object.entries({ WEBHOOK_SECRET, AIRTABLE_PAT, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID, AVINODE_TOKEN })) {
  if (!v) { console.error(`FATAL: env var ${k} is required`); process.exit(1); }
}

const app = express();
app.use(express.json());

const bridgeHTML = fs.readFileSync(path.join(__dirname, 'bridge.html'), 'utf8').replace('{{AVINODE_TOKEN}}', AVINODE_TOKEN);
app.get('/bridge', (_req, res) => res.type('html').send(bridgeHTML));
app.get('/healthz', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));

// Simple in-process queue so concurrent webhooks don't exhaust memory
let chain = Promise.resolve();
const enqueue = (fn) => (chain = chain.then(fn, fn));

async function fetchRecord(id) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${id}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } });
  if (!res.ok) throw new Error(`Airtable GET ${res.status}: ${await res.text()}`);
  return res.json();
}

async function patchRecord(id, fields) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable PATCH ${res.status}: ${await res.text()}`);
}

function recordToQuote(rec) {
  const f = rec.fields;
  const iso = (v) => {
    if (!v) return null;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    return new Date(v).toISOString().slice(0, 10);
  };
  return {
    from: (f['Departure Airport'] || '').trim().toUpperCase(),
    to: (f['Arrival Airport'] || '').trim().toUpperCase(),
    date: iso(f['Departure Date/Time']),
    pax: Number(f['Pax Count'] || 2),
    aircraftCategory: f['Aircraft Category'] || '',
    contact: {
      name: f['Client'] || f['Contact First Name'] || DEFAULT_CONTACT_NAME,
      email: f['Contact Email'] || DEFAULT_CONTACT_EMAIL,
      phone: f['Contact Phone'] || DEFAULT_CONTACT_PHONE,
      message: f['Trip Notes'] || `Charter quote request for ${f['Client'] || 'client'}.`,
    },
  };
}

app.post('/fire', async (req, res) => {
  if (req.get('X-Webhook-Secret') !== WEBHOOK_SECRET) return res.status(401).json({ error: 'unauthorized' });
  const recordId = req.body?.recordId;
  if (!recordId) return res.status(400).json({ error: 'recordId required' });

  res.json({ ok: true, queued: recordId }); // respond fast; work runs async

  enqueue(async () => {
    const started = Date.now();
    try {
      const rec = await fetchRecord(recordId);
      const quote = recordToQuote(rec);
      console.log(`[${recordId}] firing ${quote.from}→${quote.to} ${quote.date} ${quote.pax}pax`);
      const result = await fireQuote(quote, {
        bridgeUrl: `http://localhost:${PORT}/bridge`,
        headless: true,
        inquireAllClasses: INQUIRE_ALL === 'true',
      });
      const fields = result.ok && result.sends.some(s => s.sent)
        ? { 'Status': 'Sent to Avinode', 'Last Updated': new Date().toISOString().slice(0, 10) }
        : { 'Status': 'Error', 'Last Updated': new Date().toISOString().slice(0, 10) };
      await patchRecord(recordId, fields).catch(e => console.error(`[${recordId}] patch failed: ${e.message}`));
      console.log(`[${recordId}] done in ${Date.now() - started}ms — ${JSON.stringify(result)}`);
    } catch (e) {
      console.error(`[${recordId}] failed: ${e.message}`);
      await patchRecord(recordId, { 'Status': 'Error' }).catch(() => {});
    }
  });
});

app.listen(PORT, () => console.log(`listening :${PORT}`));
