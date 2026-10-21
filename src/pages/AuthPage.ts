import { expect, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import type { TestCustomer } from '../data/customer';

/**
 * Login + registration forms. Used on /account/login and /checkout/register
 * (checkout variant additionally offers guest checkout).
 */
export class AuthPage extends BasePage {
  get loginForm(): Locator {
    return this.$(this.s.login.form).first();
  }
  get registerForm(): Locator {
    return this.$(this.s.register.form).first();
  }

  async open(): Promise<void> {
    await this.goto(this.cfg.routes.login);
    await expect(this.loginForm).toBeVisible();
  }

  /** Registration route — core renders login + register there, some themes only register. */
  async openRegister(): Promise<void> {
    await this.goto(this.cfg.routes.register);
    await expect(this.registerForm).toBeVisible();
  }

  // ---------------- login ----------------
  async login(email: string, password: string): Promise<void> {
    // On /checkout/register the login form is collapsed
    const toggle = this.$(this.s.login.collapseToggle).first();
    if ((await toggle.isVisible()) && !(await this.$(this.s.login.email).isVisible())) await toggle.click();

    await this.$(this.s.login.email).fill(email);
    await this.$(this.s.login.password).fill(password);
    await this.$(this.s.login.submit).click();
  }

  async loginAndExpectSuccess(email: string, password: string): Promise<void> {
    await this.login(email, password);
    await expect(this.page).not.toHaveURL(/\/account\/login/);
  }

  get loginError(): Locator {
    return this.loginForm.locator(this.s.page.alertDanger).or(this.$(`${this.s.page.main} ${this.s.page.alertDanger}`)).first();
  }

  // ---------------- registration ----------------
  async fillRegistration(c: TestCustomer, opts: { guest?: boolean } = {}): Promise<void> {
    const r = this.s.register;
    const form = this.registerForm;

    // theme hides the register form behind a tab / toggle
    if (r.openToggle && !(await form.locator(r.email).isVisible())) {
      await this.$(r.openToggle).locator('visible=true').first().click();
      await expect(form.locator(r.email)).toBeVisible();
    }

    // inverted checkbox: checked = continue as guest
    const guest = r.guestCheckbox ? form.locator(r.guestCheckbox) : undefined;
    if (guest && (await guest.count())) await guest.setChecked(!!opts.guest, { force: true });

    // /checkout/register: checkbox; /account/login: hidden input (value=1) → leave it alone
    const createAccount = form.locator(`${r.createAccount}[type="checkbox"]`);
    if (await createAccount.count()) {
      // checkout variant: checked = create account, unchecked = guest
      await createAccount.setChecked(!opts.guest, { force: true });
    }

    const salutation = form.locator(r.salutation);
    if (await salutation.isVisible()) await salutation.selectOption({ index: c.salutationIndex });

    await form.locator(r.firstName).fill(c.firstName);
    await form.locator(r.lastName).fill(c.lastName);
    await form.locator(r.email).fill(c.email);

    const pw = form.locator(r.password);
    if (!opts.guest && (await pw.isVisible())) {
      await pw.fill(c.password);
      const confirmation = form.locator(r.passwordConfirmation);
      if (await confirmation.isVisible()) await confirmation.fill(c.password);
    }

    await form.locator(r.street).fill(c.address.street);
    await form.locator(r.zipcode).fill(c.address.zipcode);
    await form.locator(r.city).fill(c.address.city);
    await this.selectOptionByLabel(form.locator(r.country).first(), c.address.countryLabel);
    // state options are loaded after the country is chosen
    await this.selectOptionByLabel(form.locator(r.countryState).first(), c.address.stateLabel, true);

    const phone = form.locator(r.phoneNumber).first();
    if (c.address.phoneNumber && (await phone.isVisible())) await phone.fill(c.address.phoneNumber);

    const dp = form.locator(r.dataProtection);
    if (await dp.count()) await dp.check({ force: true });
  }

  private async selectOptionByLabel(select: Locator, label?: string, waitForOptions = false): Promise<void> {
    if (!label) return;
    if (waitForOptions) {
      // e.g. the state select is only shown/filled once the country is chosen
      await expect(select.locator('option').filter({ hasText: new RegExp(label, 'i') }).first())
        .toBeAttached({ timeout: 5_000 })
        .catch(() => undefined);
    }
    if (!(await select.isVisible())) return;
    const values = await select.locator('option').evaluateAll((opts, src) => {
      const rx = new RegExp(src, 'i');
      return opts.filter((o) => rx.test(o.textContent ?? '')).map((o) => (o as HTMLOptionElement).value);
    }, new RegExp(label, 'i').source);
    if (values[0]) await select.selectOption(values[0]);
  }

  async submitRegistration(): Promise<void> {
    await this.registerForm.locator(this.s.register.submit).first().click();
  }

  async register(c: TestCustomer, opts: { guest?: boolean } = {}): Promise<void> {
    await this.fillRegistration(c, opts);
    await this.submitRegistration();
  }

  get invalidFields(): Locator {
    return this.registerForm.locator(this.s.page.invalidField);
  }

  /** Inline invalid fields (client/server validation) or an error alert on the page. */
  get validationErrors(): Locator {
    return this.invalidFields.or(this.page.locator(`${this.s.page.main} ${this.s.page.alertDanger}`)).locator('visible=true');
  }
}
