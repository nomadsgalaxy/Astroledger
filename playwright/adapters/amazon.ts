// Amazon order-history adapter.
// Opens a headed Chromium pointed at amazon.com/your-orders, optionally signs
// in if asked, scrapes the visible orders. User completes any 2FA manually.

import type { Adapter, AdapterOrderDraft } from './types';

export const adapter: Adapter = {
  id: 'amazon',
  label: 'Amazon (Orders)',
  description: 'Scrapes your Amazon order history. Opens a visible browser; you complete 2FA manually if asked.',
  async run({ browser, creds, sinceDays = 90 }) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('https://www.amazon.com/your-orders/orders', { waitUntil: 'domcontentloaded' });

    // If redirected to sign-in
    if (page.url().includes('/ap/signin')) {
      const emailField = page.locator('#ap_email');
      if (await emailField.count()) {
        await emailField.fill(creds.username);
        await page.click('#continue');
      }
      await page.locator('#ap_password').fill(creds.password);
      await page.click('#signInSubmit');
      // Wait up to 5 minutes for user to clear OTP / CAPTCHA if presented
      await page.waitForURL(/your-orders|your-account/, { timeout: 5 * 60_000 });
    }

    await page.waitForSelector('.order-card, .a-box-group', { timeout: 30_000 });

    const cards = await page.locator('.order-card, .a-box-group').all();
    const orders: AdapterOrderDraft[] = [];
    const cutoff = Date.now() - sinceDays * 86400000;
    for (const c of cards) {
      const text = (await c.innerText()).replace(/\s+/g, ' ');
      const idMatch = text.match(/order\s*#\s*([0-9-]{10,})/i);
      const totalMatch = text.match(/\$\s?([0-9]+(?:[,][0-9]{3})*(?:\.[0-9]{2}))/);
      const dateMatch = text.match(/(?:placed|order placed)?\s*([A-Z][a-z]+ \d{1,2},? \d{4})/);
      if (!idMatch || !totalMatch || !dateMatch) continue;
      const orderDate = new Date(dateMatch[1]);
      if (+orderDate < cutoff) continue;
      const items = (await c.locator('a.a-link-normal').allInnerTexts())
        .map(t => t.trim()).filter(t => t.length > 4 && t.length < 200)
        .slice(0, 5).map(name => ({ name }));
      orders.push({
        source: 'playwright:amazon',
        externalId: idMatch[1],
        merchant: 'Amazon',
        amount: parseFloat(totalMatch[1].replace(/,/g, '')),
        orderDate: orderDate.toISOString(),
        items,
        url: `https://www.amazon.com/gp/your-account/order-details?orderID=${idMatch[1]}`,
      });
    }

    await ctx.close();
    return orders;
  },
};
