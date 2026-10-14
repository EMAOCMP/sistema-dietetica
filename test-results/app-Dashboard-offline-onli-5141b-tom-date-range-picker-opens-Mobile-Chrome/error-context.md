# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: app.spec.ts >> Dashboard offline/online flow >> custom date range picker opens
- Location: tests\e2e\app.spec.ts:29:3

# Error details

```
TimeoutError: page.waitForSelector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('text=Resumen Operativo') to be visible

```

# Page snapshot

```yaml
- generic [ref=e5]:
  - generic [ref=e6]:
    - heading "Dietética Vishal" [level=1] [ref=e10]
    - paragraph [ref=e11]: Control de Stock y Ventas
  - generic [ref=e12]:
    - generic [ref=e13]:
      - generic [ref=e14]: Correo Electrónico
      - textbox "admin@dietetica.com" [ref=e20]
    - generic [ref=e21]:
      - generic [ref=e22]: Contraseña
      - textbox "••••••••" [ref=e28]
    - button "Iniciar Sesión" [ref=e29] [cursor=pointer]
  - button "¿Primer usuario? Crea tu cuenta de Administrador" [ref=e31] [cursor=pointer]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Dashboard offline/online flow', () => {
  4  |   test.beforeEach(async ({ page }) => {
  5  |     await page.goto('/');
  6  |     // Wait for app to load
> 7  |     await page.waitForSelector('text=Resumen Operativo', { timeout: 15000 });
     |                ^ TimeoutError: page.waitForSelector: Timeout 15000ms exceeded.
  8  |   });
  9  | 
  10 |   test('dashboard loads and shows KPIs', async ({ page }) => {
  11 |     // Check KPI cards are visible
  12 |     await expect(page.locator('text=Ventas (Tickets)')).toBeVisible();
  13 |     await expect(page.locator('text=Ingresos Totales')).toBeVisible();
  14 |     await expect(page.locator('text=Ganancia Neta')).toBeVisible();
  15 |     await expect(page.locator('text=Stock Crítico')).toBeVisible();
  16 |   });
  17 | 
  18 |   test('date range buttons work', async ({ page }) => {
  19 |     await page.click('button:has-text("Semana")');
  20 |     await expect(page.locator('button:has-text("Semana")')).toHaveClass(/bg-sky-600/);
  21 |     
  22 |     await page.click('button:has-text("Mes")');
  23 |     await expect(page.locator('button:has-text("Mes")')).toHaveClass(/bg-sky-600/);
  24 |     
  25 |     await page.click('button:has-text("Hoy")');
  26 |     await expect(page.locator('button:has-text("Hoy")')).toHaveClass(/bg-sky-600/);
  27 |   });
  28 | 
  29 |   test('custom date range picker opens', async ({ page }) => {
  30 |     await page.click('button:has-text("Personalizado")');
  31 |     await expect(page.locator('text=Rango personalizado')).toBeVisible();
  32 |     await expect(page.locator('text=Desde')).toBeVisible();
  33 |     await expect(page.locator('text=Hasta')).toBeVisible();
  34 |   });
  35 | });
  36 | 
  37 | test.describe('POS offline/online flow', () => {
  38 |   test.beforeEach(async ({ page }) => {
  39 |     await page.goto('/');
  40 |     await page.waitForSelector('text=Resumen Operativo', { timeout: 15000 });
  41 |     // Navigate to POS
  42 |     await page.click('button:has-text("Caja")');
  43 |     await page.waitForSelector('text=Cliente General', { timeout: 10000 });
  44 |   });
  45 | 
  46 |   test('can add products to cart', async ({ page }) => {
  47 |     // Find first product card and click
  48 |     const productCard = page.locator('.bg-white.rounded-2xl').first();
  49 |     await productCard.click();
  50 |     await expect(page.locator('text=Cliente General')).toBeVisible();
  51 |     // Cart should have items
  52 |     await expect(page.locator('text=Total')).toBeVisible();
  53 |   });
  54 | 
  55 |   test('can park and resume sale', async ({ page }) => {
  56 |     // Add product
  57 |     const productCard = page.locator('.bg-white.rounded-2xl').first();
  58 |     await productCard.click();
  59 |     
  60 |     // Park sale
  61 |     await page.click('button:has-text("En espera")');
  62 |     await page.fill('input[placeholder*="nombre"]', 'Cliente Test');
  63 |     await page.click('button:has-text("Guardar")');
  64 |     
  65 |     // Resume
  66 |     await page.click('button:has-text("Multiticket")');
  67 |     await expect(page.locator('text=Cliente Test')).toBeVisible();
  68 |     await page.click('button:has-text("Retomar")');
  69 |   });
  70 | });
  71 | 
  72 | test.describe('Offline indicator', () => {
  73 |   test('shows when offline', async ({ page, context }) => {
  74 |     await page.goto('/');
  75 |     await page.waitForSelector('text=Resumen Operativo', { timeout: 15000 });
  76 |     
  77 |     // Go offline
  78 |     await context.setOffline(true);
  79 |     
  80 |     // Should show offline indicator
  81 |     await expect(page.locator('text=Sin conexión')).toBeVisible({ timeout: 5000 });
  82 |     
  83 |     // Go online
  84 |     await context.setOffline(false);
  85 |     
  86 |     // Should show syncing or connected
  87 |     await expect(page.locator('text=Conectado')).toBeVisible({ timeout: 10000 });
  88 |   });
  89 | });
```