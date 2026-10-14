import { test, expect } from '@playwright/test';

test.describe('Dashboard basic load', () => {
  test('app loads without errors', async ({ page }) => {
    await page.goto('/');
    // Wait for any content to load
    await page.waitForLoadState('networkidle');
    // Just verify the page loads without crashing
    await expect(page).toHaveTitle(/Dietética/);
  });
});