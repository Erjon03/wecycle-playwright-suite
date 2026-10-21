import { expect, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { parsePrice } from '../utils/price';
import type { ProductRef } from '../config/types';

export class ProductPage extends BasePage {
  get name(): Locator {
    return this.$(this.s.product.name).first();
  }
  get price(): Locator {
    return this.$(this.s.product.price).first();
  }
  get productNumber(): Locator {
    return this.$(this.s.product.productNumber).first();
  }
  get buyButton(): Locator {
    return this.$(this.s.product.buyButton).first();
  }
  get quantity(): Locator {
    return this.$(this.s.product.quantityInput).first();
  }
  get configuratorGroups(): Locator {
    return this.$(this.s.product.configuratorGroup);
  }

  async open(product: ProductRef | string): Promise<void> {
    await this.goto(typeof product === 'string' ? product : product.path);
    await expect(this.name).toBeVisible();
  }

  /** Product number text — themes that hide it only render it as `<meta itemprop="sku" content>`. */
  async productNumberValue(): Promise<string> {
    const el = this.productNumber;
    await expect(el).toBeAttached();
    return ((await el.getAttribute('content')) ?? (await el.innerText())).trim();
  }

  async priceValue(): Promise<number> {
    return parsePrice(await this.price.innerText());
  }

  async setQuantity(qty: number): Promise<void> {
    await this.quantity.fill(String(qty));
  }

  async addToCart(qty?: number): Promise<void> {
    if (qty) await this.setQuantity(qty);
    await this.waitForXhr('/checkout/offcanvas', () => this.buyButton.click());
  }

  /**
   * Selects another option in the given configurator group (by index).
   * Shopware reloads the page/URL for the new variant.
   */
  async switchVariant(groupIndex: number): Promise<{ before: string; after: string }> {
    const group = this.configuratorGroups.nth(groupIndex);
    // dropdown-style configurator: open the group's menu so its options become clickable
    if (this.s.product.configuratorDropdownToggle) await group.locator(this.s.product.configuratorDropdownToggle).first().click();
    if (this.s.product.variantOptionLink) {
      // theme renders variant options as plain links to the variant URL
      const before = await this.productNumberValue();
      const option = group.locator(this.s.product.variantOptionLink).first();
      const label = (await option.innerText()).split('\n')[0].trim();
      // theme JS may fetch the variant and swap the buy box in place instead of navigating
      await option.click();
      await expect.poll(() => this.productNumberValue(), { timeout: 15_000 }).not.toBe(before);
      if (this.s.product.variantSelectedOption) {
        await expect(this.configuratorGroups.nth(groupIndex).locator(this.s.product.variantSelectedOption)).toContainText(label);
      }
      return { before, after: await this.productNumberValue() };
    }
    const before = await this.productNumberValue();
    const options = group.locator(this.s.product.configuratorOptionInput);
    const count = await options.count();
    for (let i = 0; i < count; i++) {
      const opt = options.nth(i);
      if ((await opt.isChecked()) || (await opt.isDisabled())) continue;
      const cls = (await opt.getAttribute('class')) ?? '';
      if (!cls.includes('is-combinable')) continue;
      const id = await opt.getAttribute('id');
      await Promise.all([
        this.page.waitForURL((u) => !u.pathname.endsWith(before), { timeout: 15_000 }),
        this.page.locator(`label[for="${id}"]`).click(),
      ]);
      await expect.poll(() => this.productNumberValue()).not.toBe(before);
      return { before, after: await this.productNumberValue() };
    }
    throw new Error('No alternative combinable variant option found');
  }

  get wishlistButton(): Locator {
    return this.$(this.s.product.wishlistButton).first();
  }
}
