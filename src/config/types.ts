import type { Selectors } from '../selectors/shopware67';

/** Deep partial helper used for project-level overrides. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/**
 * Switch storefront features on/off per client project.
 * Tests for a disabled feature are skipped automatically.
 */
export interface FeatureFlags {
  wishlist: boolean;
  guestCheckout: boolean;
  registration: boolean;
  /** Registration requires e-mail confirmation (double opt-in). */
  doubleOptInRegistration: boolean;
  productReviews: boolean;
  contactForm: boolean;
  newsletter: boolean;
  promotionCodes: boolean;
  /** Cookie consent banner is shown to first-time visitors. */
  cookieBanner: boolean;
  languageSwitch: boolean;
  currencySwitch: boolean;
  /** Mobile off-canvas navigation exists (Shopware default). */
  mobileNavigation: boolean;
  /**
   * Orders can be completed on this environment — with an offline method (Vorkasse /
   * Rechnung, see testData.paymentMethod) or a sandbox test card (testData.cardPayment).
   * False when neither is possible — tests that place an order are skipped.
   */
  placeOrder: boolean;
  /** Header account button opens a dropdown for guests (Shopware default). False: it links to the login page. Unset = true. */
  guestAccountDropdown?: boolean;
  /** Unknown URLs render the themed storefront error page. False e.g. when staging runs in debug mode. Unset = true. */
  themedErrorPages?: boolean;
  /** Header search navigates to the /search page (Shopware default). False: results open in an overlay on the current page. Unset = true. */
  headerSearchNavigates?: boolean;
  /** Header cart button shows the cart total (Shopware default). False: it only shows an item count → total checks are skipped. Unset = true. */
  headerCartTotal?: boolean;}

export interface ProductRef {
  /** SEO path relative to baseURL, e.g. "/Canvas-Tote-Bag/A-BAG-001-CREAM" */
  path: string;
  productNumber: string;
  name: string;
}

export interface RedirectRule {
  from: string;
  /** Expected final path (regex source or plain path prefix). */
  to: string;
  /** Only applies to logged-out visitors (default true). */
  guestOnly?: boolean;
}

export interface CustomerAddress {
  street: string;
  zipcode: string;
  city: string;
  /** ISO 3166 alpha-2, resolved to a countryId via Store API / UI */
  countryIso: string;
  /** Visible country name in the storefront select (used by UI flows). */
  countryLabel?: string;
  /** ISO 3166-2 state code, e.g. "US-FL" — needed when the country forces a state. */
  stateShortCode?: string;
  /** Visible state name in the storefront select (used by UI flows). */
  stateLabel?: string;
  /** Needed when core.loginRegistration.phoneNumberFieldRequired is on. */
  phoneNumber?: string;
}

export interface TestCard {
  number: string;
  /** As typed into the expiry field, e.g. "04 / 33" */
  expiry: string;
  /** Fixed CVV; random 3 digits when omitted. */
  cvv?: string;
}

/**
 * Browser state applied to every test context before the first page load —
 * e.g. to pass age gates or suppress marketing popups the theme remembers.
 */
export interface BrowserPreset {
  /** localStorage entries set on the storefront origin. */
  localStorage?: Record<string, string>;
  /** Cookies set on the storefront domain. */
  cookies?: Record<string, string>;
  /** URL patterns aborted in the browser (third-party popups/widgets), e.g. /klaviyo\.com/. */
  blockUrls?: RegExp[];
}

export interface ProjectConfig {
  /** Human readable name, shown in reports. */
  name: string;
  /* no baseURL: the storefront URL comes only from BASE_URL (.env / CI variable) */
  /** Shopware storefront locale — used for price parsing only. */
  locale: string;
  currencySymbol: string;

  features: FeatureFlags;

  /** Paths of important storefront routes (override for custom routing). */
  routes: {
    home: string;
    login: string;
    register: string;
    account: string;
    accountProfile: string;
    accountAddresses: string;
    accountOrders: string;
    logout: string;
    cart: string;
    checkoutRegister: string;
    checkoutConfirm: string;
    checkoutFinish: string;
    search: string;
    wishlist: string;
    /** Path of a CMS page containing the contact form (null = discover via footer). */
    contactPage: string | null;
  };

  testData: {
    /** Main navigation category names in display order (first N are checked). */
    mainCategories: string[];
    /** A category with enough products for listing / filter / sorting tests. */
    listingCategoryPath: string;
    /** A simple (non-variant) product that can be bought. */
    simpleProduct: ProductRef;
    /** A product with variants (configurator). */
    variantProduct: ProductRef & { optionGroups: string[] };
    /** Search term that returns results. */
    searchTerm: string;
    /** Minimum number of hits expected for searchTerm. */
    searchMinResults: number;
    /** Search term guaranteed to return nothing. */
    searchNoResultTerm: string;
    /** Filter types that must exist on the listing page (language independent). */
    expectedFilterTypes: Array<'manufacturer' | 'properties' | 'price' | 'rating' | 'boolean'>;
    /** Sorting option keys that must exist (Shopware values). */
    expectedSortings: string[];
    customer: {
      emailDomain: string;
      emailPrefix: string;
      password: string;
      firstName: string;
      lastName: string;
      /** true: customers built by buildCustomer() get a last name naming the running test (e.g. "CheckoutGuestCheckoutPlacesAnOrder"); lastName is the fallback. Unset = false. */
      lastNameFromTest?: boolean;
      /** Salutation option index in the select (0 = "not specified"). */
      salutationIndex: number;
      address: CustomerAddress;
    };
    /** Visible text of the footer link leading to the contact form. */
    contactLinkText: RegExp;
    /** Payment/shipping method labels to select in checkout; null = keep default. */
    paymentMethod: string | null;
    shippingMethod: string | null;
    promotionCode: string | null;
    /**
     * Sandbox test card, filled into the card form (selectors.cardPayment) after the
     * order is submitted. Only publicly documented gateway test cards — never real ones.
     */
    cardPayment?: TestCard;
  };

  /** Redirects that must work (checked for guests unless stated). */
  redirects: RedirectRule[];

  /** Links (paths) that must resolve with a status < 400. */
  importantLinks: string[];

  /** Timeouts in ms for slow shops / staging servers (optional). Unset = test 60s, expect 10s, action 15s, navigation 30s. */
  timeouts?: { test?: number; expect?: number; action?: number; navigation?: number };

  /** Browser state for age gates / popups (optional). */
  preset?: BrowserPreset;

  /** Selector overrides for themes / customisations. Merged over Shopware 6.7 defaults. */
  selectors?: DeepPartial<Selectors>;
}

/** Final config after env overrides + selector merge. */
export interface ResolvedConfig extends Omit<ProjectConfig, 'selectors'> {
  /** From BASE_URL, without trailing slash. */
  baseURL: string;
  selectors: Selectors;
  env: {
    httpCredentials?: { username: string; password: string };
    admin: {
      clientId?: string;
      clientSecret?: string;
      username?: string;
      password?: string;
    };
    accessKey?: string;
    allowWriteTests: boolean;
    cleanupTestData: boolean;
  };
}
