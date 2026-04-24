// Fire a single Avinode RFQ using Playwright.
// Usage: const { fireQuote } = require('./fire');
//        const result = await fireQuote({ from, to, date, pax, contact });
const { chromium } = require('playwright');

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

async function pickAirport(page, which, code) {
  const search = page.frameLocator('#avinodeSearchForm');
  const picker = page.frameLocator('#avinodeAirportPicker');
  const inputName = which === 'from' ? 'startAirport' : 'endAirport';

  await search.locator(`input[name="${inputName}"]`).click();
  await page.waitForTimeout(400);
  await search.locator(`input[name="${inputName}"]`).fill(code);
  await page.waitForTimeout(1200);

  const items = picker.locator('li');
  const count = await items.count();
  if (count === 0) throw new Error(`no airport suggestions for ${code}`);
  await items.first().click();
  await page.waitForTimeout(300);
}

async function setPax(page, target) {
  const search = page.frameLocator('#avinodeSearchForm');
  const current = parseInt(await search.locator('input[name="paxCount"]').inputValue() || '2', 10);
  const delta = target - current;
  if (delta === 0) return;
  const btn = search.locator(delta > 0 ? 'button:has-text("+")' : 'button:has-text("-")').first();
  for (let i = 0; i < Math.abs(delta); i++) { await btn.click(); await page.waitForTimeout(80); }
}

async function setDate(page, isoDate) {
  const search = page.frameLocator('#avinodeSearchForm');
  const datePicker = page.frameLocator('#avinodeDatePicker');
  const overlay = search.locator('[data-testid="date-time-input__close-overlay"]');
  if (await overlay.count() > 0) { await overlay.first().click().catch(() => {}); await page.waitForTimeout(300); }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
  await search.locator('input[name="date"]').click({ force: true });
  await page.waitForTimeout(1000);

  const [y, m, d] = isoDate.split('-').map(Number);
  const monthName = MONTH_NAMES[m - 1];
  for (let tries = 0; tries < 24; tries++) {
    const header = (await datePicker.locator('.react-datepicker__current-month').first().innerText().catch(() => '')).trim();
    if (header === `${monthName} ${y}`) break;
    await datePicker.locator('button[aria-label="Next Month"]').click().catch(() => {});
    await page.waitForTimeout(250);
  }
  const label = `${d} ${monthName} ${y}`;
  const cell = datePicker.locator(`[role="option"][aria-label*="${label}"]:not([aria-disabled="true"])`);
  if (!(await cell.count())) throw new Error(`date cell not found for ${label}`);
  await cell.first().click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape').catch(() => {});
}

async function fireQuote(q, opts = {}) {
  const { bridgeUrl = 'http://localhost:3000/bridge', headless = true, inquireAllClasses = false } = opts;
  const tag = (q.from || '??') + '→' + (q.to || '??');
  const log = (m) => console.log(`  [fire:${tag}] ${m}`);
  const browser = await chromium.launch({ headless, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  try {
    log(`goto ${bridgeUrl}`);
    await page.goto(bridgeUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('#avinodeSearchForm', { timeout: 15000 });
    await page.waitForTimeout(3500);

    const search = page.frameLocator('#avinodeSearchForm');
    await search.locator('select.currency-selector-input').selectOption('USD').catch(() => {});
    log('currency=USD');

    await pickAirport(page, 'from', q.from); log(`from=${q.from} picked`);
    await pickAirport(page, 'to', q.to); log(`to=${q.to} picked`);
    await setDate(page, q.date); log(`date=${q.date} set`);
    await setPax(page, q.pax); log(`pax=${q.pax} set`);

    // Verify form state before search
    const preSearch = {
      start: await search.locator('input[name="startAirport"]').inputValue().catch(() => 'ERR'),
      end: await search.locator('input[name="endAirport"]').inputValue().catch(() => 'ERR'),
      date: await search.locator('input[name="date"]').inputValue().catch(() => 'ERR'),
      pax: await search.locator('input[name="paxCount"]').inputValue().catch(() => 'ERR'),
    };
    log(`pre-search values: ${JSON.stringify(preSearch)}`);

    await page.mouse.click(10, 10);
    await page.waitForTimeout(400);

    log('clicking Search');
    await search.locator('button.search-form__submit, button:has-text("Search")').first().click({ force: true });
    await page.waitForTimeout(6000);

    const inquireCount = await search.locator('button:has-text("Inquire")').count();
    log(`inquire buttons visible: ${inquireCount}`);
    if (!inquireCount) {
      const body = await search.locator('body').innerText().catch(() => '');
      log(`no inquires — body snippet: ${body.replace(/\s+/g, ' ').slice(0, 300)}`);
      throw new Error('no Inquire buttons after Search');
    }

    // Scrape each result card: walk up until text contains "Est. flight time" (unique to aircraft card),
    // stop before we engulf the whole frame (which contains the currency list).
    const cards = await search.locator('button:has-text("Inquire")').evaluateAll(btns =>
      btns.map((b, i) => {
        let el = b, depth = 0;
        while (el && depth < 12) {
          const text = (el.innerText || '').trim();
          if (/est\.?\s*flight\s*time/i.test(text) && text.length < 800) {
            return { index: i, text: text.replace(/\s+/g, ' ') };
          }
          el = el.parentElement; depth++;
        }
        return { index: i, text: (b.innerText || '').trim().replace(/\s+/g, ' ') };
      })
    );
    log(`result cards: ${JSON.stringify(cards.map(c => ({ i: c.index, text: c.text.slice(0, 90) })))}`);

    // Match record's Aircraft Category to a card (case-insensitive substring, flexible)
    const wanted = (q.aircraftCategory || '').toLowerCase().replace(/\s+/g, '');
    // Needles must be specific enough to NOT substring-match "flight time" (appears in every card) or other generic text.
    const aliases = {
      'lightjet': ['light jet'],
      'superlight': ['super light', 'superlight'],
      'midjet': ['midsize jet', 'mid jet', 'midjet'],
      'supermidjet': ['super mid jet', 'super midsize'],
      'heavyjet': ['heavy jet'],
      'ultralongrange': ['lag categories', 'ultra long', 'long range'],
      'turboprop': ['turbo prop', 'turboprop'],
    };
    const needles = aliases[wanted] || (q.aircraftCategory ? [q.aircraftCategory.toLowerCase()] : []);
    log(`wanted category="${q.aircraftCategory}" needles=${JSON.stringify(needles)}`);

    let pickedIndex = 0;
    if (needles.length) {
      const match = cards.find(c => needles.some(n => c.text.toLowerCase().includes(n)));
      if (match) { pickedIndex = match.index; log(`matched card[${pickedIndex}]: ${match.text.slice(0,80)}`); }
      else log(`WARN no card matched — falling back to index 0`);
    }

    const targets = inquireAllClasses ? inquireCount : 1;
    const sends = [];
    for (let k = 0; k < targets; k++) {
      const i = inquireAllClasses ? k : pickedIndex;
      const btns = await search.locator('button:has-text("Inquire")').all();
      if (!btns[i]) { log(`no button at index ${i}`); break; }
      log(`clicking Inquire[${i}]`);
      await btns[i].click({ force: true });
      await page.waitForTimeout(3000);

      // Verify the contact form appeared
      const nameField = search.locator('input[name="name"]');
      const nameVisible = await nameField.count();
      log(`name field count after Inquire click: ${nameVisible}`);
      if (!nameVisible) {
        const body = await search.locator('body').innerText().catch(() => '');
        log(`no name field — body snippet: ${body.replace(/\s+/g, ' ').slice(0, 300)}`);
        sends.push({ index: i, sent: false, error: 'contact form never opened' });
        break;
      }

      await nameField.fill(q.contact.name);
      await search.locator('input[name="email"]').fill(q.contact.email);
      if (q.contact.phone) await search.locator('input[name="phoneNumber"]').fill(q.contact.phone);
      await search.locator('input[name="message"]').fill(q.contact.message || '');
      await page.waitForTimeout(500);

      const filled = {
        name: await nameField.inputValue().catch(() => ''),
        email: await search.locator('input[name="email"]').inputValue().catch(() => ''),
        phone: await search.locator('input[name="phoneNumber"]').inputValue().catch(() => ''),
      };
      log(`filled: ${JSON.stringify(filled)}`);

      log('clicking Send inquiry');
      await search.locator('button:has-text("Send inquiry")').click({ force: true });
      await page.waitForTimeout(6000);

      const confirmText = await search.locator('body').innerText().catch(() => '');
      const sent = /inquiry sent/i.test(confirmText);
      log(`sent=${sent} · snippet: ${confirmText.replace(/\s+/g, ' ').slice(0, 200)}`);
      sends.push({ index: i, sent, snippet: confirmText.replace(/\s+/g, ' ').slice(0, 200) });
      if (!sent) break;
    }

    return { ok: true, sends, pageErrors };
  } catch (e) {
    log(`EXCEPTION: ${e.message}`);
    return { ok: false, error: e.message, pageErrors };
  } finally {
    await browser.close();
  }
}

module.exports = { fireQuote };
