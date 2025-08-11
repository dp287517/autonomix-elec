const puppeteer = require('puppeteer');
let browser = null;

async function captureChart(url, selector) {
  if (!browser) browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector(selector, { timeout: 60000 });
    await page.evaluate(() => new Promise(r => setTimeout(r, 2000)));
    const el = await page.$(selector);
    if (!el) throw new Error(`Sélecteur ${selector} introuvable`);
    const screenshot = await el.screenshot({ type: 'png' });
    return screenshot;
  } finally {
    await page.close();
  }
}

async function closeBrowser() {
  if (browser) { await browser.close(); browser = null; }
}

module.exports = { captureChart, closeBrowser };
