import { expect, type Locator } from '@playwright/test';
import { BasePage } from '../pages/BasePage';
import { parsePrice } from '../utils/price';

/** WeCycle product page extras: financing tab (Consors Finanz). */
export class WecycleProductPage extends BasePage {
  get financingTab(): Locator {
    return this.$('.wc-pdp-tabs__navigation-link[href^="#financing-tab"]').first();
  }
  get financingSummary(): Locator {
    return this.$('.wc-financing-summary').first();
  }
  get financingRows(): Locator {
    return this.financingSummary.locator('.wc-financing-summary__row');
  }

  async openFinancing(): Promise<void> {
    await this.financingTab.click();
    await expect(this.financingSummary).toBeVisible();
  }
}

export interface SalePrice {
  current: number;
  old: number;
  discountPercent: number;
}

/** WeCycle listing extras: "Artikel pro Seite" dropdown and sale prices in the product boxes. */
export class WecycleListingPage extends BasePage {
  get limitToggle(): Locator {
    return this.$('.wecycle-listing-limit__toggle').locator('visible=true').first();
  }
  get currentLimit(): Locator {
    return this.$('[data-wecycle-listing-limit-current]').locator('visible=true').first();
  }

  async chooseLimit(limit: number): Promise<void> {
    await this.limitToggle.click();
    await this.$(`[data-wecycle-listing-limit-value="${limit}"]`).locator('visible=true').first().click();
  }

  /** Product boxes that show an old (crossed-out) price next to the current one. */
  get discountedBoxes(): Locator {
    return this.$(this.s.listing.productBox).filter({ has: this.page.locator('.wecycle-product-box__price-old') });
  }

  async salePrices(): Promise<SalePrice[]> {
    const boxes = await this.discountedBoxes.all();
    const prices: SalePrice[] = [];
    for (const box of boxes) {
      const [current, old, discount] = await Promise.all([
        box.locator('.wecycle-product-box__price-current').first().innerText(),
        box.locator('.wecycle-product-box__price-old').first().innerText(),
        box.locator('.wecycle-product-box__price-discount').first().innerText(),
      ]);
      // "-23 %" → 23
      prices.push({ current: parsePrice(current), old: parsePrice(old), discountPercent: Math.abs(parseInt(discount.replace(/[^\d-]/g, ''), 10)) });
    }
    return prices;
  }
}
