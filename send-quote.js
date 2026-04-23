// Drive one Avinode quote through the embedded form end-to-end.
// node send-quote.js
const { chromium } = require('playwright');

const QUOTES = [
  {
    client: 'Legacy Operations',
    from: 'KTEB', to: 'KBCT', date: '2026-04-30', pax: 4,
    contact: {
      name: 'Legacy Operations',
      email: 'flight-ops@legacyaviationgroup.com',
      phone: '+1 646 801 5387',
      message: 'Requesting charter quote for Legacy Operations. Please provide pricing and aircraft availability. Thank you.'
    }
  },
];

async function dumpFrame(page, selector, label) {
  const frame = page.frameLocator(selector);
  const html = await frame.locator('body').innerHTML().catch(() => '(could not read)');
  console.log(`\n=== ${label} (${selector}) — ${html.length} chars ===`);
  console.log(html.slice(0, 2500));
}

async function pickAirport(page, which, code) {
  const search = page.frameLocator('#avinodeSearchForm');
  const picker = page.frameLocator('#avinodeAirportPicker');
  const inputName = which === 'from' ? 'startAirport' : 'endAirport';

  await search.locator(`input[name="${inputName}"]`).click();
  await page.waitForTimeout(500);
  await search.locator(`input[name="${inputName}"]`).fill(code);

  // Wait for airport picker list to populate
  await page.waitForTimeout(1500);
  const items = picker.locator('li');
  const count = await items.count();
  console.log(`  [${which}] picker items for "${code}": ${count}`);
  if (count > 0) {
    await items.first().click();
    console.log(`  [${which}] clicked first suggestion`);
  } else {
    console.log(`  [${which}] WARNING no suggestions`);
  }
  await page.waitForTimeout(500);
}

async function setPax(page, target) {
  const search = page.frameLocator('#avinodeSearchForm');
  const current = parseInt(await search.locator('input[name="paxCount"]').inputValue() || '2', 10);
  const delta = target - current;
  console.log(`  pax: ${current} → ${target} (${delta > 0 ? '+' : ''}${delta})`);
  const btn = search.locator(delta > 0 ? 'button:has-text("+")' : 'button:has-text("-")').first();
  for (let i = 0; i < Math.abs(delta); i++) {
    await btn.click();
    await page.waitForTimeout(100);
  }
}

async function setDate(page, isoDate) {
  const search = page.frameLocator('#avinodeSearchForm');
  const datePicker = page.frameLocator('#avinodeDatePicker');

  // Dismiss any popover overlay left behind by airport picker
  const overlay = search.locator('[data-testid="date-time-input__close-overlay"]');
  if (await overlay.count() > 0) {
    await overlay.first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);

  await search.locator('input[name="date"]').click({ force: true });
  await page.waitForTimeout(1200);

  const html = await datePicker.locator('body').innerHTML().catch(() => '');
  console.log(`  date picker opened, html len=${html.length}`);
  console.log('  [DATE PICKER HTML SAMPLE]\n' + html.slice(0, 4000));

  // Parse target date
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const targetMonth = monthNames[target.getMonth()];
  const targetYear = target.getFullYear();

  console.log(`  target: ${targetMonth} ${targetYear}, day ${d}`);
  for (let tries = 0; tries < 24; tries++) {
    const headerText = await datePicker.locator('.react-datepicker__current-month').first().innerText().catch(() => '');
    if (headerText.trim() === `${targetMonth} ${targetYear}`) { console.log(`    header matched after ${tries} clicks`); break; }
    await datePicker.locator('button[aria-label="Next Month"]').click().catch(() => {});
    await page.waitForTimeout(300);
  }

  const dayLabel = `${d} ${targetMonth} ${targetYear}`;
  const dayCell = datePicker.locator(`[role="option"][aria-label*="${dayLabel}"]:not([aria-disabled="true"])`);
  const found = await dayCell.count();
  console.log(`    day cell matching "${dayLabel}" found: ${found}`);
  if (found) {
    await dayCell.first().click();
    console.log(`    clicked ${dayLabel}`);
  }
  await page.waitForTimeout(500);
  // Dismiss picker overlay so Search button is reachable
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
}

async function fillAndSearch(page, q) {
  console.log(`\n━━━ ${q.client} · ${q.from} → ${q.to} · ${q.date} · ${q.pax} pax ━━━`);
  // Set currency to USD
  const searchFrame = page.frameLocator('#avinodeSearchForm');
  await searchFrame.locator('select.currency-selector-input').selectOption('USD').catch(e => console.log(`  currency set failed: ${e.message.split('\n')[0]}`));
  console.log('  currency → USD');
  await page.waitForTimeout(300);

  await pickAirport(page, 'from', q.from);
  await pickAirport(page, 'to', q.to);
  await setDate(page, q.date);
  await setPax(page, q.pax);

  await page.screenshot({ path: `/tmp/avinode-${q.from}-${q.to}-prefilled.png`, fullPage: true });
  console.log(`  screenshot: /tmp/avinode-${q.from}-${q.to}-prefilled.png`);

  const search = page.frameLocator('#avinodeSearchForm');
  // Pre-click diagnostics — iframe geometry
  const iframes = await page.evaluate(() => [...document.querySelectorAll('iframe')].map(f => { const r = f.getBoundingClientRect(); return { id: f.id, x: r.x, y: r.y, w: r.width, h: r.height, visible: f.offsetWidth > 0 && f.offsetHeight > 0 }; }));
  console.log('  [pre-search iframes]', JSON.stringify(iframes));
  const startVal = await search.locator('input[name="startAirport"]').inputValue().catch(() => 'ERR');
  const endVal = await search.locator('input[name="endAirport"]').inputValue().catch(() => 'ERR');
  const dateVal = await search.locator('input[name="date"]').inputValue().catch(() => 'ERR');
  const paxVal = await search.locator('input[name="paxCount"]').inputValue().catch(() => 'ERR');
  console.log(`  [pre-search values] start=${startVal} end=${endVal} date=${dateVal} pax=${paxVal}`);
  const submitBtns = await search.locator('button').evaluateAll(btns => btns.map(b => ({ type: b.type, text: b.innerText.slice(0, 30), disabled: b.disabled }))).catch(e => `ERR: ${e.message}`);
  console.log('  [submit buttons]', JSON.stringify(submitBtns));

  // Close any open popover by clicking the outer page background
  await page.mouse.click(10, 10).catch(() => {});
  await page.waitForTimeout(500);
  // Re-check geometry
  const iframesAfter = await page.evaluate(() => [...document.querySelectorAll('iframe')].map(f => { const r = f.getBoundingClientRect(); return { id: f.id, x: r.x, y: r.y, w: r.width, h: r.height }; }));
  console.log('  [iframes after background-click]', JSON.stringify(iframesAfter));

  console.log('  clicking Search');
  // Try multiple selector strategies, fall back to JS dispatch
  const searchBtn = search.locator('button.search-form__submit, button:has-text("Search")').first();
  try {
    await searchBtn.click({ force: true, timeout: 8000 });
    console.log('  Search click via locator');
  } catch (e) {
    console.log(`  locator click failed (${e.message.split('\n')[0]}) — falling back to JS click`);
    await search.locator('button').evaluateAll(btns => {
      const b = btns.find(b => b.type === 'submit' || /search/i.test(b.innerText));
      if (b) b.click();
      return b ? 'clicked' : 'not-found';
    });
  }
  await page.waitForTimeout(5000);

  await page.screenshot({ path: `/tmp/avinode-${q.from}-${q.to}-results.png`, fullPage: true });
  console.log(`  screenshot: /tmp/avinode-${q.from}-${q.to}-results.png`);

  // Wait for results, then click first Inquire
  await page.waitForTimeout(3000);
  const iframeIds = await page.evaluate(() => [...document.querySelectorAll('iframe')].map(f => f.id));
  console.log('  iframes present:', iframeIds);

  // Find Inquire button inside the search frame (results live here)
  const inquireCount = await search.locator('button:has-text("Inquire"), a:has-text("Inquire")').count();
  console.log(`  Inquire buttons visible: ${inquireCount}`);
  if (inquireCount === 0) { console.log('  no Inquire — dumping frame'); await dumpFrame(page, '#avinodeSearchForm', 'no-inquire frame'); return; }

  console.log('  clicking first Inquire');
  await search.locator('button:has-text("Inquire")').first().click({ force: true, timeout: 10000 });
  await page.waitForTimeout(3000);

  await page.screenshot({ path: `/tmp/avinode-${q.from}-${q.to}-rfq-form.png`, fullPage: true });

  // Fill RFQ form
  console.log('  filling RFQ form');
  await search.locator('input[name="name"]').fill(q.contact.name);
  await search.locator('input[name="email"]').fill(q.contact.email);
  if (q.contact.phone) await search.locator('input[name="phoneNumber"]').fill(q.contact.phone);
  await search.locator('input[name="message"]').fill(q.contact.message);
  await page.waitForTimeout(500);

  const filledValues = {
    name: await search.locator('input[name="name"]').inputValue(),
    email: await search.locator('input[name="email"]').inputValue(),
    phone: await search.locator('input[name="phoneNumber"]').inputValue().catch(() => '(none)'),
    message: await search.locator('input[name="message"]').inputValue(),
  };
  console.log('  [RFQ filled]', JSON.stringify(filledValues));

  await page.screenshot({ path: `/tmp/avinode-${q.from}-${q.to}-rfq-filled.png`, fullPage: true });

  console.log('  clicking Send inquiry — 🚨 LIVE RFQ FIRING 🚨');
  await search.locator('button:has-text("Send inquiry")').click({ force: true });
  await page.waitForTimeout(6000);

  await page.screenshot({ path: `/tmp/avinode-${q.from}-${q.to}-sent.png`, fullPage: true });

  // Try to capture the confirmation / trip ID
  const postSendHTML = await search.locator('body').innerHTML().catch(() => '');
  console.log('  [post-send html len]', postSendHTML.length);
  const refMatch = postSendHTML.match(/(?:trip|reference|inquiry|confirmation|rfq)[\s#:]*([A-Z0-9\-]{4,})/i);
  if (refMatch) console.log(`  ✅ captured ref: ${refMatch[1]}`);
  const snippet = postSendHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600);
  console.log('  [confirmation text]', snippet);
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 120 });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.log(`[page err] ${msg.text()}`); });

  await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#avinodeSearchForm', { timeout: 15000 });
  await page.waitForTimeout(4000);

  // Do just the first quote so we can observe results
  await fillAndSearch(page, QUOTES[0]);

  console.log('\n→ done first quote. Holding 20s for observation...');
  await page.waitForTimeout(20000);
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
