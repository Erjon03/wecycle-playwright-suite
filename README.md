# WeCycle Playwright Suite

**Playwright + TypeScript** E2E tests for the **WeCycle Shopware 6.7 storefront**.

Based on the solution25 Shopware Playwright skeleton: the core tests in `tests/storefront/` are
shop-agnostic and reused unchanged. Everything WeCycle-specific lives in **one profile file**,
`projects/wecycle.ts`.

---

## Quick start

```bash
npm ci
npx playwright install --with-deps chromium
cp .env.example .env          # fill in BASE_URL, NEW_ACCOUNT_PASSWORD, admin API credentials
npm run test:smoke            # critical path, chromium
npm test                      # full suite: chromium + mobile (Pixel 7), without @sends-message
npm run test:messages         # only the tests that send a real message (contact form)
npm run report                # open the HTML report
```

Useful variants:

```bash
npx playwright test tests/storefront/cart.spec.ts --headed
npx playwright test --grep @mobile --project=mobile
EXTRA_BROWSERS=firefox,webkit npm test
ALLOW_WRITE_TESTS=false npm test   # read-only: no customers, orders or form submissions
npm run test:ui                    # Playwright UI mode for debugging
```

The storefront URL is never stored in the repo: it comes from `BASE_URL` in `.env` (locally) or the
`BASE_URL` repository secret (CI). The suite refuses to start without it.

---

## Architecture

```
├── playwright.config.ts        # projects: setup → chromium/[firefox/webkit]/mobile → cleanup
├── .env.example                # secrets & environment switches (never commit .env)
├── projects/                   # ★ one profile per shop — the ONLY file you normally edit
│   ├── wecycle.ts              #   WeCycle profile
│   ├── shared/test-identity.ts #   QA test identity (names, e-mail prefix/domain)
│   ├── demo.ts                 #   skeleton demo shop
│   └── _template.ts            #   template for a new profile
├── src/
│   ├── config/                 # types + loader (profile + env overrides + selector merge)
│   ├── selectors/shopware67.ts # core storefront selectors (class/id/name based, language independent)
│   ├── api/                    # AdminApiClient (setup/cleanup), StoreApiClient (fast data setup)
│   ├── data/                   # test data builders (unique customers)
│   ├── components/             # Header, MainNavigation, CookieBanner, OffcanvasCart
│   ├── pages/                  # Page Objects: Listing, Product, Cart, Auth, Account, Checkout, Contact
│   ├── fixtures/index.ts       # ★ extended `test` — page objects, API clients, customer, loggedInPage
│   ├── client/                 # WeCycle-specific page objects/fixtures
│   └── utils/                  # price parsing, sorting helpers
└── tests/
    ├── setup/                  # health check (before) + test-data cleanup (after)
    ├── storefront/             # ★ core Shopware tests — never edited for one client
    └── client/                 # WeCycle-only tests (@client)
```

### Design principles

| Principle | How |
|---|---|
| **No hardcoded shop data** | Products, categories, search terms, routes, redirects, feature flags → `projects/wecycle.ts`. URL and secrets → `.env` / CI secrets. |
| **Language independent** | Selectors use Shopware core classes, ids and form field names — never visible texts. Assertions use body classes (`is-ctl-checkout`) and URLs. |
| **Theme overrides without forking** | `selectors` in the profile is deep-merged over `shopware67Selectors`. Override only the keys the WeCycle theme changes. |
| **Feature flags** | Tests for features the shop does not have skip automatically (e.g. `features.currencySwitch = false`). |
| **Fast, isolated test data** | Customers are created via Store API, carts filled via the storefront endpoint, cleanup via Admin API. Every test gets its own customer — tests run fully parallel. |
| **Graceful degradation** | No Admin/Store API credentials? Registration and cart setup fall back to UI flows. |
| **Read-only mode** | `ALLOW_WRITE_TESTS=false` skips everything that creates data (orders, customers, contact form). |
| **Page Objects expose intent, specs assert** | `cart.setQuantity(name, 2)` in POM; `expect(...)` stays in the spec. |

### Fixtures

```ts
import { test, expect } from '../../src/fixtures';

test('customer orders', async ({ loggedInPage, cartHelper, checkout, account, cfg }) => {
  await cartHelper.add(cfg.testData.simpleProduct, 2); // API speed, UI session
  await checkout.openConfirm();
  await checkout.placeOrder();
  await account.openOrders();
  await expect(account.orders.first()).toBeVisible();
});
```

| Fixture | Scope | Purpose |
|---|---|---|
| `cfg` | worker | resolved project config (profile + env + selectors) |
| `adminApi` / `storeApi` | worker | API clients, `null` if no credentials |
| `header`, `navigation`, `listing`, `product`, `cart`, `offcanvasCart`, `auth`, `account`, `checkout`, `contact`, `cookieBanner` | test | page objects |
| `cartHelper` | test | put products into the storefront cart without UI clicks |
| `customer` | test | freshly registered customer (auto-deleted afterwards) |
| `loggedInPage` | test | `page` logged in as `customer` |
| `acceptCookies` | option | `test.use({ acceptCookies: false })` to see the cookie banner |
| `requireWriteAccess` | test | skip test when `ALLOW_WRITE_TESTS=false` |

### Tags

| Tag | Meaning |
|---|---|
| `@smoke` | critical path, run on every PR (`npm run test:smoke`) |
| `@mobile` | also runs in the `mobile` project (Pixel 7) |
| `@mobile-only` | runs only in the `mobile` project |
| `@client` | WeCycle-specific tests |
| `@sends-message` | submits the contact form. Allowed on WeCycle (mailer is off) and included in CI runs |

---

## Coverage (tests/storefront)

| Spec | Covers |
|---|---|
| `homepage` | header/nav/content/footer, SEO basics, logo link, JS errors, images |
| `cookie-consent` | Shopware cookie banner (skipped: WeCycle uses Usercentrics) |
| `navigation` | configured categories, every category opens, flyout, breadcrumb |
| `listing` | product boxes, PDP link, pagination, sorting (price/name), filters (manufacturer, property, price, reset) |
| `product-detail` | core info, canonical/structured data, variant switch, breadcrumb, reviews, 404 product |
| `search` | header search, relevance, suggest, no result, special characters |
| `cart` | add from PDP/listing, quantity (off-canvas + cart page), remove, persistence, promotion codes |
| `checkout` | empty cart guard, login/register gate, guest order, customer order → account, TOS required, payment/shipping methods |
| `registration` | register, empty-form validation, invalid email, short password, duplicate email |
| `login` | login/logout, wrong password, unknown user, header menu, cart kept after login |
| `account` | overview, profile update, addresses, orders, login protection |
| `wishlist` | guest add, wishlist page + remove, persistence |
| `forms` | contact form validation + submit, newsletter |
| `mobile` | off-canvas nav, burger visibility, no horizontal overflow, off-canvas filters |
| `links-and-errors` | important links, configured redirects, broken header/footer links, sitemap/robots, 404 page, bad params, bad POST |

---

## Test data

- **Test identity** (`projects/shared/test-identity.ts`): first name `SolutionErjonQATest`, a last name
  naming the flow (derived from the running test, e.g. `CheckoutGuestCheckoutPlacesAnOrder`),
  e-mails `s25-erjonqatest.<timestamp>.<rand>@gmail.com`.
- **Orders** use the offline payment method *Vorkasse* (prepayment) — no payment provider redirect.
  Find them in the admin by the customer first name `SolutionErjonQATest`.
- **Cleanup**: test customers are deleted after each test, and a teardown project deletes leftovers by
  e-mail prefix + domain (needs Admin API credentials). Orders stay in the admin.

## Credentials

1. **Admin API** — recommended: an *Integration* in the admin
   (*Settings → System → Integrations*, with admin rights) → `ADMIN_CLIENT_ID` / `ADMIN_CLIENT_SECRET`.
   Alternative: `ADMIN_USERNAME` / `ADMIN_PASSWORD` of a dedicated test admin user.
2. **Store API access key** — resolved automatically via the Admin API from `BASE_URL`,
   or set `SW_ACCESS_KEY` (*Sales Channels → Storefront → API access*).
3. **`NEW_ACCOUNT_PASSWORD`** — password for every registered test customer (required).
4. **`PROMOTION_CODE`** — a valid, unlimited test promotion code (optional; test skipped without it).

---

## Adapting to the WeCycle theme

When a core test fails, decide:

- **Different markup** → override the selector key in `projects/wecycle.ts → selectors`.
- **Feature not used** → switch the feature flag off.
- **Different data** → fix `testData`.
- **Actual bug** → report it.

> Rule: **don't edit `tests/storefront/**` for WeCycle.** If a core test needs a code change, make it
> configurable (profile option) instead, so it can go back into the skeleton.

WeCycle-only features (bicycle leasing, store pickup, Usercentrics consent, …) get their own tests in
`tests/client/` with page objects in `src/client/`, tagged `@client`.

---

## CI (GitHub Actions)

`.github/workflows/playwright.yml`:

- **Scheduled** → full suite on weekdays (Mon–Fri) at **17:17 UTC** (18:17 Berlin winter time,
  19:17 summer time), environment `staging`. The run must finish by 18:55 UTC (central report, see below).
- **Manual run** (*Actions → WeCycle storefront tests → Run workflow*) → full regression, or only
  tests matching the optional `grep` input.
- **Pull requests** → smoke suite (`@smoke`), not uploaded to the central report.
- One job, 4 workers. Only one run at a time (`concurrency`): a new run waits until the running one has finished.
- **The repository is public**, so:
  - no artifacts are uploaded (anyone with a GitHub account could download them) — results are on the
    run's summary page and in the central QA report;
  - traces, videos and screenshots are off in CI (still on for local runs);
  - URL and credentials come only from **secrets**, never from variables (variables are shown in plain text).

Configuration (*Settings → Secrets and variables → Actions → Secrets*):

| Secret | Purpose |
|---|---|
| `BASE_URL` | shop URL (required) |
| `NEW_ACCOUNT_PASSWORD` | password of registered test customers (required) |
| `ADMIN_CLIENT_ID` / `ADMIN_CLIENT_SECRET` (or `ADMIN_USERNAME` / `ADMIN_PASSWORD`) | Admin API (cleanup, stock) |
| `SW_ACCESS_KEY`, `PROMOTION_CODE`, `HTTP_USERNAME` / `HTTP_PASSWORD` | optional |
| `PROFIHOST_HOST`, `PROFIHOST_USER`, `PROFIHOST_SSH_KEY`, `PROFIHOST_KNOWN_HOSTS`, optional `PROFIHOST_PORT` | central QA reporting upload (see below) |

## Central QA reporting

Every scheduled or manual CI run is uploaded to Profihost; a central job builds the daily QA report at
**19:00 UTC** from today's (UTC) uploads, using the **latest run of the day** per project/environment.

1. **Run tests** — the JSON reporter writes `qa-report/results.json` (git-ignored).
2. **Build QA summary** (`npm run summary`, always runs) — `scripts/make-summary.ts` writes
   `qa-report/summary.json`: status (`PASSED` / `PASSED_WITH_FLAKY` / `FAILED`), counts, duration,
   branch, commit, trigger, run link and the failed tests with their first error line.
   Needs `PROJECT` (`wecycle`), `ENVIRONMENT` (`staging`) and `OWNER`.
   A missing or unreadable `results.json`, or an error outside tests (e.g. setup), gives `FAILED`.
   The script is shared ("Shared make-summary v1") — keep it identical across all QA repos.
3. **Upload to Profihost** (`scripts/upload-to-profihost.sh`) — via `sftp -b` to
   `qa-reports/wecycle/staging/<YYYY-MM-DD>/<HHMMSS>/` (date and time from the summary's `timestamp`, UTC):
   `summary.json` and `results.json`. Upload problems only give a warning, never a red run.
   The result (or the reason it failed) is shown on the run's summary page.

Secrets for the upload:

| Secret | Value |
|---|---|
| `PROFIHOST_HOST` | SFTP host. **While it is empty, the upload is skipped** (notice) and the pipeline stays green. |
| `PROFIHOST_USER` | SFTP user |
| `PROFIHOST_SSH_KEY` | ed25519 private key (whole file content) |
| `PROFIHOST_KNOWN_HOSTS` | output of `ssh-keyscan <host>` (`ssh-keyscan -p <port> <host>` for a non-22 port); the host key is checked strictly |
| `PROFIHOST_PORT` | optional, default 22 |

If `PROFIHOST_HOST` is set but one of user / key / known-hosts is missing, the upload counts as failed (warning).

**Re-run rule:** after a hotfix, re-run the suite by hand (*Run workflow*, `grep` empty), then re-run the
central report job — it uses the latest run of the day.

Local check:

```bash
npm run test:summary                                              # self-check of make-summary (fixtures)
PROJECT=wecycle ENVIRONMENT=staging OWNER="Erjon Januzaj" npm run summary   # after a local test run
```

The workflow uses the official `mcr.microsoft.com/playwright` image — keep its version in sync with
`@playwright/test`.

## Run summary (status report)

After every run, `src/reporting/RunSummaryReporter.ts` writes
`run-summary/<project>_<date>_<time>.html` / `.md` / `.json`: totals (passed / failed / flaky / blocked / skipped),
every test with status, file, browser and duration, and the first error line of each failure.
At the top (and in the console) there is the team's status report per shop, ready to paste:

```
Project: WeCycle (staging)
Tests run: 117
Passed: 99
Failed: 0
Blocked/Skipped: 18 (15 blocked: page did not load in time, 3 skipped)
Failed – already reported: 0
Tickets: none
```

- **Blocked** = the test failed only because a page did not load in time (`page.goto` / `reload` /
  `waitForURL` navigation timeout: slow or unreachable shop). It counts under Blocked/Skipped, not
  Failed. Playwright itself (exit code, HTML report, CI status) still shows these tests as failed.
- Passed includes flaky tests (passed on retry, noted in brackets).
- With real failures, "Failed – already reported" and "Tickets" are `<fill in>`: fill them in after
  triage (which failures are known bugs, which tickets) before posting.
- The files are meant to be forwarded: URLs in errors become `<url>`, URL/credential env values
  become `<redacted>`. `playwright test --list` writes no summary.
- **Local**: written automatically by every `npx playwright test` run (`run-summary/` is git-ignored).
- **CI**: shown on the run's summary page (no artifact: public repo).
- **Combined**: `npm run report:combined` merges the latest run of each project found in
  `run-summary/` (or a folder given as `npm run report:combined -- <folder>`) into
  `run-summary/combined_<date>_<time>.html` / `.md` / `-report.txt` (the status reports, ready to paste).
  Local only.

---

## WeCycle shop notes (checked 2026-10-21, Shopware 6.7.14.1)

- Storefront language German (English via language switch); tests do not depend on texts.
- Custom theme: own product boxes, a dropdown variant configurator and a custom register form —
  selector overrides are collected in the profile.
- Cookie consent via Usercentrics (blocked in tests via `preset.blockUrls`), not Shopware's cookie banner.
- Payment methods include Vorkasse and Kauf auf Rechnung (offline), PayPal, credit card, financing and
  bicycle leasing. Shipping: DPD or store pickup.
