// Open the bridge page and dump the structure of the Avinode search iframe.
// Run: node explore.js
const { chromium } = require('playwright');

const QUOTE = { from: 'KTEB', to: 'KBCT', pax: 4, date: '2026-04-30' };

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();

  page.on('console', msg => console.log(`[page] ${msg.type()}: ${msg.text()}`));

  console.log('→ navigating to bridge');
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle' });
  console.log('→ waiting for Avinode widget');
  await page.waitForSelector('#avinodeSearchForm', { timeout: 15000 });
  await page.waitForTimeout(4000);

  const search = page.frameLocator('#avinodeSearchForm');
  const airport = page.frameLocator('#avinodeAirportPicker');
  const date = page.frameLocator('#avinodeDatePicker');

  // Dump the search form DOM
  const searchHTML = await search.locator('body').innerHTML().catch(e => `ERR: ${e.message}`);
  console.log('\n=== SEARCH FORM HTML (first 4000 chars) ===');
  console.log(searchHTML.slice(0, 4000));

  console.log('\n=== SEARCH FORM INPUTS ===');
  const inputs = await search.locator('input, textarea, select, button').evaluateAll(els =>
    els.map(e => ({
      tag: e.tagName, type: e.type, name: e.name, id: e.id,
      placeholder: e.placeholder, aria: e.getAttribute('aria-label'),
      text: (e.innerText || '').trim().slice(0, 40)
    }))
  ).catch(e => `ERR: ${e.message}`);
  console.log(JSON.stringify(inputs, null, 2));

  await page.screenshot({ path: '/tmp/avinode-explore-1.png', fullPage: true });
  console.log('\n→ screenshot /tmp/avinode-explore-1.png');

  // Try clicking "From" to see airport picker behavior
  console.log('\n→ clicking From field');
  try {
    await search.locator('input[placeholder="From"]').click({ timeout: 3000 });
  } catch (e) {
    console.log(`  From click failed: ${e.message}`);
    // fallback: first empty text input
    await search.locator('input[type="text"]').first().click().catch(() => {});
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/avinode-explore-2.png', fullPage: true });
  console.log('→ screenshot /tmp/avinode-explore-2.png');

  const airportHTML = await airport.locator('body').innerHTML().catch(e => `ERR: ${e.message}`);
  console.log('\n=== AIRPORT PICKER HTML (first 3000 chars) ===');
  console.log(airportHTML.slice(0, 3000));

  console.log('\n→ typing KTEB into From');
  try {
    await airport.locator('input').first().fill('KTEB');
  } catch (e) { console.log(`  type failed: ${e.message}`); }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/avinode-explore-3.png', fullPage: true });

  console.log('\nHolding browser open 20s for observation...');
  await page.waitForTimeout(20000);
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
