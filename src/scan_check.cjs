const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1408, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'nekrok22k@gmail.com');
  await page.fill('input[type="password"]', 'Vishal2026!');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Resumen Operativo', { timeout: 25000 });
  await page.click('text=Productos / Stock');
  await page.waitForTimeout(1500);
  await page.click('button:has-text("+ Nuevo Producto")');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'C:\\Users\\swami\\AppData\\Local\\Temp\\opencode\\prod_modal.png' });
  const scanBtn = page.locator('button[title="Escanear con cámara"]').first();
  console.log('scanBtn count:', await scanBtn.count());
  if (await scanBtn.count() > 0) {
    await scanBtn.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'C:\\Users\\swami\\AppData\\Local\\Temp\\opencode\\scanner_v2.png' });
  }
  console.log('pageerrors:', JSON.stringify(errors.slice(0, 3)));
  await browser.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
