import type { ProjectConfig } from '../src/config/types';
import { testIdentity } from './shared/test-identity';

/**
 * Project profile: WeCycle (Shopware 6.7.14.1 staging, German storefront, custom WeCycle theme).
 *
 *   PROJECT=wecycle npx playwright test --grep @smoke
 *
 * - URL: BASE_URL in .env / GitHub Actions variable — never in this file.
 * - Secrets (admin API, customer password, promotion code): .env / GitHub Actions secrets.
 * - All core tests run here (orders, registrations, contact form, newsletter are allowed —
 *   the shop's mailer is off). Only features the shop does not have are switched off below.
 * - Data verified on 2026-10-21 against the storefront HTML. Theme selectors still need the
 *   first smoke run (see TODOs in `selectors`).
 */
const config: ProjectConfig = {
  name: 'WeCycle (staging)',
  locale: 'de-DE',
  currencySymbol: '€',

  features: {
    wishlist: true, // "Merkzettel" in the header
    guestCheckout: true,
    registration: true,
    doubleOptInRegistration: false, // TODO: confirm in admin (Settings > Login & sign-up)
    productReviews: true, // review teaser on product pages
    contactForm: true,
    newsletter: true, // footer newsletter form
    promotionCodes: true, // code itself comes from PROMOTION_CODE (.env / secret)
    cookieBanner: false, // consent via Usercentrics, not Shopware's cookie bar (blocked in `preset`)
    languageSwitch: true, // de + en
    currencySwitch: false, // EUR only
    mobileNavigation: true,
    placeOrder: true, // offline payment "Vorkasse" (testData.paymentMethod)
    headerCartTotal: false, // header cart button shows only an item count, no price
    themedErrorPages: false, // staging runs in debug mode: unknown URLs show Symfony's "No route found" page (still 404)
  },

  routes: {
    home: '/',
    login: '/account/login',
    register: '/account/register',
    account: '/account',
    accountProfile: '/account/profile',
    accountAddresses: '/account/address',
    accountOrders: '/account/order',
    logout: '/account/logout',
    cart: '/checkout/cart',
    checkoutRegister: '/checkout/register',
    checkoutConfirm: '/checkout/confirm',
    checkoutFinish: '/checkout/finish',
    search: '/search',
    wishlist: '/wishlist',
    contactPage: '/Hilfe-Kontakt/Kontakt/',
  },

  testData: {
    // main navigation link titles, in display order ("Über uns" is a content page, left out)
    mainCategories: ['Fahrräder', 'E-Bikes', 'Bekleidung', 'Fahrradzubehör', 'Teile', 'Motorrad', 'Marken', 'Sale'],
    listingCategoryPath: '/zubehoer/', // 24 products per page, filters + pagination
    // accessory without variants (no bike → no leasing / no bulky shipping)
    simpleProduct: {
      path: '/zubehoer/schutzbleche/frontschutzbleche/Acid-Latzz-Fahrrad-Schutzblech-vorne-schwarz.html',
      productNumber: '392391',
      name: 'Acid Latzz Fahrrad Schutzblech vorne schwarz',
    },
    // size variants via the theme's dropdown configurator (wc-pdp-configurator)
    variantProduct: {
      path: '/Scott-Endurance-Warm-Winter-Damen-Fahrradtrikot-langarm-portobello-beige-schwarz-2027/502023',
      productNumber: '502024',
      name: 'Scott Endurance Warm Winter Damen Fahrradtrikot',
      optionGroups: ['Größe'],
    },
    searchTerm: 'Schutzblech',
    searchMinResults: 2,
    searchNoResultTerm: 'zzqx-no-such-product-4711',
    expectedFilterTypes: ['manufacturer', 'properties', 'price'],
    expectedSortings: ['name-asc', 'name-desc', 'price-asc', 'price-desc'],
    customer: {
      ...testIdentity,
      password: '', // from NEW_ACCOUNT_PASSWORD (.env / secret) — the loader throws if it is missing
      salutationIndex: 1,
      address: {
        street: 'Teststraße 1',
        zipcode: '66111',
        city: 'Saarbrücken',
        countryIso: 'DE',
        countryLabel: 'Deutschland|Germany',
        phoneNumber: '0681 1234567',
      },
    },
    contactLinkText: /Kontakt|Contact/i,
    paymentMethod: 'Vorkasse', // offline prepayment, no redirect to a payment provider
    shippingMethod: null, // keep the default (DPD) — TODO: confirm it is preselected for accessories
    promotionCode: null, // from PROMOTION_CODE (.env / secret)
  },

  redirects: [
    { from: '/account', to: '/account/login' },
    { from: '/account/order', to: '/account/login' },
    { from: '/account/profile', to: '/account/login' },
    { from: '/checkout/confirm', to: '/checkout/cart' },
  ],

  importantLinks: [
    '/',
    '/fahrraeder/',
    '/fahrraeder/e-bikes-pedelecs/',
    '/bekleidung/',
    '/zubehoer/',
    '/teile/',
    '/motorrad/',
    '/Marken/',
    '/Sale/',
    '/Hilfe-Kontakt/Kontakt/',
    '/Information/Impressum/',
    '/Information/AGB/',
    '/Information/Datenschutz/',
    '/Information/Widerrufsrecht/',
    '/checkout/cart',
    '/account/login',
    '/search?search=Schutzblech',
    '/sitemap.xml',
    '/robots.txt',
  ],

  // staging is slow: category pages 5–16 s, search ~7 s, suggest ~3.5 s (measured 2026-10-21);
  // "every main category opens" walks home → category 8 times (> 120 s)
  timeouts: { test: 240_000, expect: 20_000, action: 30_000, navigation: 45_000 },

  preset: {
    // Usercentrics consent overlay would cover the page in every test
    blockUrls: [/usercentrics\.eu/],
  },

  // Custom WeCycle theme — verified against the live storefront on 2026-10-21 (first full run + DOM probes).
  selectors: {
    header: {
      logo: 'header .header-logo-main-link', // the footer repeats the logo link
      // two search inputs with the same id (desktop + mobile), only one visible
      searchInput: '.header-search-input >> visible=true',
      searchToggle: '.header-action-link--search-toggle',
    },
    navigation: {
      flyoutLink: '.navigation-flyout-group__link',
      offcanvas: '.navigation-offcanvas.show', // a services off-canvas also exists
      // accordion menu: main categories are <summary> entries (only "Sale" is a link)
      offcanvasCategoryEntry: '.navigation-offcanvas-link--main',
    },
    listing: {
      productName: '.wecycle-product-box__title a',
      productPrice: '.wecycle-product-box__price-current',
      productImage: '.wecycle-product-box__image',
      buyButton: '.wecycle-product-box__cart-button',
      wishlistButton: '.product-wishlist-btn',
      filterPanelToggle: '.wecycle-listing-toolbar__filter-trigger', // mobile: opens the filter off-canvas
    },
    search: {
      productName: '.wecycle-product-box__title a',
    },
    product: {
      productNumber: 'meta[itemprop="sku"]', // SKU not shown on the PDP
      // sticky purchase bar + hero buy box render the buy form twice, only one visible
      buyButton: '.btn-buy >> visible=true',
      quantityInput: '.js-quantity-selector >> visible=true',
      // sizes in a dropdown; picking one swaps the buy box in place (URL stays, SKU changes)
      configuratorDropdownToggle: '[data-bs-toggle="dropdown"]',
      variantOptionLink: 'input.product-detail-configurator-option-input:not(:checked) + label.is-combinable',
      variantSelectedOption: '.wc-pdp-configurator__select-value',
      tax: '.wc-pdp-sticky-purchase-bar__tax-info', // core tax notice is rendered but hidden
    },
    offcanvasCart: {
      lineItem: '.wecycle-offcanvas-cart-item',
      quantityInput: 'select[name="quantity"]',
      plus: '', // quantity is a <select>, no +/- buttons
      minus: '',
      remove: '.wecycle-offcanvas-cart-item__remove-button',
      checkoutButton: '.wecycle-offcanvas-cart__button--primary',
      cartLink: '.wecycle-offcanvas-cart__button--secondary',
    },
    cart: {
      lineItem: '.wecycle-offcanvas-cart-item',
      quantityInput: 'select[name="quantity"]',
      plus: '',
      minus: '',
      remove: '.wecycle-offcanvas-cart-item__remove-button',
      summaryTotal: '.wecycle-cart-page__total-value',
      checkoutButton: '.wecycle-cart-page__checkout-button',
      promotionToggle: '.wecycle-cart-page__promotion-summary',
      promotionInput: '.wecycle-cart-page__promotion-input',
      promotionSubmit: '.wecycle-cart-page__promotion-submit',
    },
    register: {
      // /checkout/register: tabs "Bestandskunde" / "Neukunde" — the container is the visible gate
      form: '.wecycle-checkout-auth, form.register-form',
      openToggle: '.wecycle-checkout-auth__tab[data-bs-target="#wecycle-checkout-new"]',
      submit: '.wecycle-register-form__button',
      firstName: '#personalFirstName',
      lastName: '#personalLastName',
      // "Als Gast fortfahren" (checked = guest) shares the name createCustomerAccount
      createAccount: 'input[name="createCustomerAccount"][type="hidden"]',
      guestCheckbox: '#continueAsGuest',
    },
    checkout: {
      address: '.wecycle-checkout-confirm-address__item',
      lineItem: '.wecycle-checkout-summary-item',
      finishHeader: '.wecycle-checkout-finish-hero__title',
      finishOrderNumber: '.wecycle-checkout-finish-hero__order',
    },
    account: {
      orderItem: '.wecycle-account-order', // one <article> per order on /account/order
    },
    contact: {
      subject: '', // hidden field, filled by the CMS form itself
    },
    wishlist: {
      remove: '.product-wishlist-btn',
    },
  },
};

export default config;
