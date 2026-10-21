import { test, expect } from '../../src/fixtures';

test.describe('Cart', () => {
  test('add product from detail page opens off-canvas cart', { tag: ['@smoke', '@mobile'] }, async ({ product, offcanvasCart, header, cfg }) => {
    const p = cfg.testData.simpleProduct;
    await product.open(p);
    const price = await product.priceValue();
    await product.addToCart();

    await offcanvasCart.expectOpen();
    await expect(offcanvasCart.lineItem(p.name)).toBeVisible();

    // header widget refreshes asynchronously / on next page load → verify after reload
    // automatic cart promotions (e.g. a sitewide sale) can lower the total below the PDP price
    if (cfg.features.headerCartTotal === false) return; // header shows no total
    await product.page.reload();
    await expect.poll(() => header.cartTotal()).toBeGreaterThan(0);
    expect(await header.cartTotal()).toBeLessThanOrEqual(price + 0.001);
  });

  test('add product from listing', async ({ listing, product, offcanvasCart, cfg }) => {
    await listing.open(cfg.testData.listingCategoryPath);
    const idx = await listing.firstBuyableIndex();
    let name: string;
    if (idx >= 0) {
      name = await listing.addToCartFromListing(idx);
    } else {
      // listing has no buy buttons → open the product from the listing and add it on its detail page
      const priced = await listing.firstPricedIndex();
      test.skip(priced < 0, 'No purchasable product on listing');
      name = await listing.openProduct(priced);
      await product.addToCart();
    }
    await offcanvasCart.expectOpen();
    await expect(offcanvasCart.lineItem(name)).toBeVisible();
  });

  test('add with quantity > 1 from detail page', async ({ product, cart, cfg }) => {
    const p = cfg.testData.simpleProduct;
    await product.open(p);
    await product.addToCart(3);
    await cart.open();
    expect(await cart.quantityOf(p.name)).toBe(3);
  });

  test('update quantity in off-canvas cart', async ({ product, offcanvasCart, cfg }) => {
    const p = cfg.testData.simpleProduct;
    await product.open(p);
    await product.addToCart();
    await offcanvasCart.increaseQuantity(p.name);
    await expect(offcanvasCart.lineItem(p.name).locator(cfg.selectors.offcanvasCart.quantityInput)).toHaveValue('2');
  });

  test('update quantity on cart page recalculates total', { tag: '@smoke' }, async ({ cart, cartHelper, cfg }) => {
    const p = cfg.testData.simpleProduct;
    await cartHelper.add(p, 1);
    await cart.open();
    const single = await cart.totalValue();
    await cart.setQuantity(p.name, 2);
    expect(await cart.quantityOf(p.name)).toBe(2);
    await expect.poll(() => cart.totalValue()).toBeGreaterThan(single);
  });

  test('remove product from cart page', { tag: '@smoke' }, async ({ cart, cartHelper, cfg }) => {
    const p = cfg.testData.simpleProduct;
    await cartHelper.add(p, 1);
    await cart.open();
    await expect(cart.lineItem(p.name)).toBeVisible();
    await cart.remove(p.name);
    await cart.expectEmpty();
  });

  test('remove product from off-canvas cart', async ({ product, offcanvasCart, cfg }) => {
    const p = cfg.testData.simpleProduct;
    await product.open(p);
    await product.addToCart();
    await offcanvasCart.remove(p.name);
    await expect(offcanvasCart.lineItems).toHaveCount(0);
  });

  test('cart persists across page navigation', async ({ page, cart, cartHelper, header, cfg }) => {
    await cartHelper.add(cfg.testData.simpleProduct, 1);
    await page.goto(cfg.testData.listingCategoryPath);
    if (cfg.features.headerCartTotal !== false) await expect.poll(() => header.cartTotal()).toBeGreaterThan(0);
    await cart.open();
    await expect(cart.lineItems).toHaveCount(1);
  });

  test('invalid promotion code is rejected', async ({ page, cart, cartHelper, cfg }) => {
    test.skip(!cfg.features.promotionCodes, 'promotion codes disabled');
    await cartHelper.add(cfg.testData.simpleProduct, 1);
    await cart.open();
    await cart.applyPromotion('E2E-INVALID-CODE-4711');
    await expect(page.locator(`${cfg.selectors.page.alertDanger}, .alert-warning`).first()).toBeVisible();
  });

  test('valid promotion code reduces total', async ({ cart, cartHelper, cfg }) => {
    const code = cfg.testData.promotionCode;
    test.skip(!cfg.features.promotionCodes || !code, 'No promotion code configured');
    await cartHelper.add(cfg.testData.simpleProduct, 1);
    await cart.open();
    const before = await cart.totalValue();
    await cart.applyPromotion(code!);
    await expect.poll(() => cart.totalValue()).toBeLessThan(before);
  });
});
