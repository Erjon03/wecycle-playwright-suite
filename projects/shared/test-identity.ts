/**
 * solution25 QA test identity — every customer, order and form submission the suite creates
 * uses it, so test data is easy to recognise and clean up in the admin.
 *
 * - first name: always "SolutionErjonQATest" (letters only — WeCycle's forms reject digits and hyphens)
 * - last name: names the flow (derived from the running test, see customer.lastNameFromTest);
 *   `lastName` is only the fallback for places that read the profile directly (contact form)
 * - e-mail: s25-erjonqatest.<timestamp>.<random>@gmail.com — the cleanup deletes customers by
 *   this prefix + domain, so never reuse it for real accounts
 */
export const testIdentity = {
  firstName: 'SolutionErjonQATest',
  lastName: 'ContactForm',
  lastNameFromTest: true,
  emailPrefix: 's25-erjonqatest',
  emailDomain: 'gmail.com',
} as const;
