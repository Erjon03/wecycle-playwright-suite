import { test } from '../../src/fixtures';

/** Removes leftover test customers (e-mail prefix/domain from the project profile). */
test('delete leftover test customers', async ({ cfg, adminApi }) => {
  test.skip(!adminApi || !cfg.env.cleanupTestData, 'Cleanup disabled or no Admin API credentials');
  const { emailPrefix, emailDomain } = cfg.testData.customer;
  const deleted = await adminApi!.deleteTestCustomers(emailPrefix, emailDomain);
  test.info().annotations.push({ type: 'cleanup', description: `Deleted ${deleted} test customers` });
});
