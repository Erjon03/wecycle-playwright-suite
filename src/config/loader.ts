import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { shopware67Selectors, type Selectors } from '../selectors/shopware67';
import type { ProjectConfig, ResolvedConfig } from './types';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

const str = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);

function deepMerge<T>(base: T, override: unknown): T {
  if (!override || typeof override !== 'object') return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    const b = out[k];
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RegExp) && b && typeof b === 'object'
        ? deepMerge(b, v)
        : v;
  }
  return out as T;
}

let cached: ResolvedConfig | undefined;

/**
 * Loads projects/<PROJECT>.ts (default "demo"), applies env overrides and
 * merges selector overrides over the Shopware 6.7 defaults.
 */
export function loadConfig(): ResolvedConfig {
  if (cached) return cached;

  const projectName = str(process.env.PROJECT) ?? 'demo';
  const projectFile = path.resolve(__dirname, '../../projects', `${projectName}.ts`);
  if (!fs.existsSync(projectFile)) {
    throw new Error(`Project profile not found: projects/${projectName}.ts (set PROJECT=<name>)`);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(projectFile);
  const project: ProjectConfig = mod.default ?? mod.config;

  // storefront URL only from .env / CI variable — profiles carry no URL, so it stays out of git
  const rawBaseURL = str(process.env.BASE_URL);
  if (!rawBaseURL) {
    throw new Error(`No storefront URL: set BASE_URL in .env (locally) or as a CI variable (profile ${projectName})`);
  }
  const baseURL = rawBaseURL.replace(/\/+$/, '');
  const selectors = deepMerge<Selectors>(shopware67Selectors, project.selectors);

  // password given to every customer the suite registers: .env wins over the profile
  const customerPassword = str(process.env.NEW_ACCOUNT_PASSWORD) ?? project.testData.customer.password;
  if (!customerPassword) {
    throw new Error(`No test customer password: set NEW_ACCOUNT_PASSWORD in .env (profile ${projectName} has none)`);
  }

  // promotion codes are real, redeemable codes → .env / CI secret wins over the profile
  const promotionCode = str(process.env.PROMOTION_CODE) ?? project.testData.promotionCode;

  const httpUser = str(process.env.HTTP_USERNAME);
  const httpPass = str(process.env.HTTP_PASSWORD);

  cached = {
    ...project,
    testData: { ...project.testData, promotionCode, customer: { ...project.testData.customer, password: customerPassword } },
    baseURL,
    selectors,
    env: {
      httpCredentials: httpUser && httpPass ? { username: httpUser, password: httpPass } : undefined,
      admin: {
        clientId: str(process.env.ADMIN_CLIENT_ID),
        clientSecret: str(process.env.ADMIN_CLIENT_SECRET),
        username: str(process.env.ADMIN_USERNAME),
        password: str(process.env.ADMIN_PASSWORD),
      },
      accessKey: str(process.env.SW_ACCESS_KEY),
      allowWriteTests: bool(process.env.ALLOW_WRITE_TESTS, true),
      cleanupTestData: bool(process.env.CLEANUP_TEST_DATA, true),
    },
  };
  return cached;
}

export function hasAdminCredentials(cfg: ResolvedConfig): boolean {
  const a = cfg.env.admin;
  return Boolean((a.clientId && a.clientSecret) || (a.username && a.password));
}
