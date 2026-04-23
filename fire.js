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
  const browser = await chromium.launch({ headless, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  try {
    await page.goto(bridgeUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('#avinodeSearchForm', { timeout: 15000 });
    await page.waitForTimeout(3500);

    const search = page.frameLocator('#avinodeSearchForm');
    await search.locator('select.currency-selector-input').selectOption('USD').catch(() => {});

    await pickAirport(page, 'from', q.from);
    await pickAirport(page, 'to', q.to);
    await setDate(page, q.date);
    await setPax(page, q.pax);

    // Dismiss any popover before Search
    await page.mouse.click(10, 10);
    await page.waitForTimeout(400);

    await search.locator('button.search-form__submit, button:has-text("Search")').first().click({ force: true });
    await page.waitForTimeout(4500);

    const inquireCount = await search.locator('button:has-text("Inquire")').count();
    if (!inquireCount) throw new Error('no Inquire buttons after Search');

    const targets = inquireAllClasses ? inquireCount : 1;
    const sends = [];
    for (let i = 0; i < targets; i++) {
      // Re-query each time — the DOM may have shifted after previous send
      const btns = await search.locator('button:has-text("Inquire")').all();
      if (!btns[i]) break;
      await btns[i].click({ force: true });
      await page.waitForTimeout(2500);

      await search.locator('input[name="name"]').fill(q.contact.name);
      await search.locator('input[name="email"]').fill(q.contact.email);
      if (q.contact.phone) await search.locator('input[name="phoneNumber"]').fill(q.contact.phone);
      await search.locator('input[name="message"]').fill(q.contact.message || '');
      await page.waitForTimeout(300);

      await search.locator('button:has-text("Send inquiry")').click({ force: true });
      await page.waitForTimeout(5000);

      const confirmText = await search.locator('body').innerText().catch(() => '');
      const sent = /inquiry sent/i.test(confirmText);
      sends.push({ index: i, sent, snippet: confirmText.replace(/\s+/g, ' ').slice(0, 200) });
      if (!sent) break;
    }

    return { ok: true, sends, pageErrors };
  } catch (e) {
    return { ok: false, error: e.message, pageErrors };
  } finally {
    await browser.close();
  }
}

module.exports = { fireQuote };
