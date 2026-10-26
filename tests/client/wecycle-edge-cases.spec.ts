import { test, expect } from '../../src/client/fixtures';
import { buildCustomer } from '../../src/data/customer';
import { wecycleClientData as data } from '../../projects/wecycle';

/**
 * WeCycle edge cases — theme/plugin features that are not standard Shopware.
 * Read-only: no orders, no customers (the registration tests stop at client-side validation).
 */
test.describe('WeCycle edge cases', { tag: '@client' }, () => {
  test.skip(process.env.PROJECT !== 'wecycle', 'WeCycle-only tests');

  test('bike product page shows the financing summary with a monthly rate', async ({ wecycleProduct }) => {
    await wecycleProduct.goto(data.financingProductPath);
    await wecycleProduct.openFinancing();
    const rate = wecycleProduct.financingRows.filter({ hasText: data.financingMonthlyRateLabel });
    await expect(rate).toHaveCount(1);
    await expect(rate).toContainText(/\d+,\d{2}\s*€/);
  });

  test('"Artikel pro Seite" switches the listing from 24 to 48 products', async ({ listing, wecycleListing }) => {
    await listing.open(data.listingLimitPath);
    await expect(wecycleListing.currentLimit).toHaveText(String(data.listingDefaultLimit));
    await expect(listing.productBoxes).toHaveCount(data.listingDefaultLimit);

    await wecycleListing.chooseLimit(data.listingLimit);
    await expect(listing.productBoxes).toHaveCount(data.listingLimit);
    await expect(wecycleListing.currentLimit).toHaveText(String(data.listingLimit));
  });

  test('sale prices: old price is higher and the discount matches', async ({ listing, wecycleListing }) => {
    await listing.open(data.salePath);
    await expect(wecycleListing.discountedBoxes.first()).toBeVisible();

    for (const p of await wecycleListing.salePrices()) {
      expect(p.old, `old ${p.old} > current ${p.current}`).toBeGreaterThan(p.current);
      const expected = ((p.old - p.current) / p.old) * 100;
      // shop rounds the percentage — allow 1 point either way
      expect(Math.abs(p.discountPercent - expected), `shown -${p.discountPercent} %, calculated ${expected.toFixed(1)} %`).toBeLessThanOrEqual(1);
    }
  });

  test('first name with digits is rejected', async ({ page, cfg, auth }) => {
    await auth.openRegister();
    await auth.fillRegistration(buildCustomer(cfg, { firstName: 'Solution25' }));
    await auth.submitRegistration();

    const firstName = auth.registerForm.locator(cfg.selectors.register.firstName);
    await expect(firstName).toHaveClass(new RegExp(cfg.selectors.page.invalidField.replace('.', '')));
    await expect(auth.registerForm.getByText(data.lettersOnlyMessage).first()).toBeVisible();
    await expect(page).toHaveURL(/\/account\/register/);
  });

  test('password confirmation that does not match is rejected', async ({ page, cfg, auth }) => {
    await auth.openRegister();
    const customer = buildCustomer(cfg);
    await auth.fillRegistration(customer);
    const confirmation = auth.registerForm.locator(cfg.selectors.register.passwordConfirmation);
    await confirmation.fill(`${customer.password}x`);
    await auth.submitRegistration();

    await expect(confirmation.and(page.locator(cfg.selectors.page.invalidField)).or(auth.validationErrors).first()).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(`${cfg.routes.account}(\\?.*)?$`));
  });
});
