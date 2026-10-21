import { request, type APIRequestContext } from '@playwright/test';
import type { ResolvedConfig } from '../config/types';

type Criteria = Record<string, unknown>;

/**
 * Minimal Shopware Admin API client (used for test data setup & cleanup).
 * Auth: integration (client_credentials) preferred, admin user (password) as fallback.
 */
export class AdminApiClient {
  private token?: { value: string; expiresAt: number };

  private constructor(
    private readonly ctx: APIRequestContext,
    private readonly cfg: ResolvedConfig,
  ) {}

  static async create(cfg: ResolvedConfig): Promise<AdminApiClient> {
    const ctx = await request.newContext({
      baseURL: cfg.baseURL,
      httpCredentials: cfg.env.httpCredentials,
      extraHTTPHeaders: { Accept: 'application/json' },
    });
    return new AdminApiClient(ctx, cfg);
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }

  private async authHeader(): Promise<Record<string, string>> {
    if (!this.token || Date.now() > this.token.expiresAt) {
      const a = this.cfg.env.admin;
      const data =
        a.clientId && a.clientSecret
          ? { grant_type: 'client_credentials', client_id: a.clientId, client_secret: a.clientSecret }
          : { grant_type: 'password', client_id: 'administration', scopes: 'write', username: a.username, password: a.password };
      const res = await this.ctx.post('/api/oauth/token', { data });
      if (!res.ok()) throw new Error(`Admin API auth failed: ${res.status()} ${await res.text()}`);
      const json = await res.json();
      this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 30) * 1000 };
    }
    return { Authorization: `Bearer ${this.token.value}` };
  }

  async search<T = Record<string, any>>(entity: string, criteria: Criteria = {}): Promise<T[]> {
    const res = await this.ctx.post(`/api/search/${entity}`, { headers: await this.authHeader(), data: criteria });
    if (!res.ok()) throw new Error(`Admin search ${entity} failed: ${res.status()} ${await res.text()}`);
    return (await res.json()).data as T[];
  }

  async patch(entity: string, id: string, data: Record<string, unknown>): Promise<void> {
    const res = await this.ctx.patch(`/api/${entity}/${id}`, { headers: await this.authHeader(), data });
    if (!res.ok()) throw new Error(`Admin PATCH ${entity}/${id} failed: ${res.status()} ${await res.text()}`);
  }

  async delete(entity: string, id: string): Promise<void> {
    const res = await this.ctx.delete(`/api/${entity}/${id}`, { headers: await this.authHeader() });
    if (!res.ok() && res.status() !== 404) throw new Error(`Admin DELETE ${entity}/${id} failed: ${res.status()}`);
  }

  /** Finds the Store API access key of the sales channel serving baseURL. */
  async resolveAccessKey(baseURL: string): Promise<string> {
    const host = new URL(baseURL).host;
    const channels = await this.search<{ accessKey: string; domains: { url: string }[] }>('sales-channel', {
      filter: [{ type: 'contains', field: 'domains.url', value: host }],
      associations: { domains: {} },
    });
    const norm = (u: string) => u.replace(/\/+$/, '');
    const exact = channels.find((c) => c.domains?.some((d) => norm(d.url) === norm(baseURL)));
    const channel = exact ?? channels[0];
    if (!channel) throw new Error(`No sales channel with a domain matching ${host}`);
    return channel.accessKey;
  }

  async findCustomerByEmail(email: string): Promise<{ id: string } | undefined> {
    const [c] = await this.search<{ id: string }>('customer', {
      filter: [{ type: 'equals', field: 'email', value: email }],
      limit: 1,
    });
    return c;
  }

  async activateCustomer(email: string): Promise<void> {
    const c = await this.findCustomerByEmail(email);
    if (c) await this.patch('customer', c.id, { active: true, doubleOptInRegistration: false });
  }

  async deleteCustomerByEmail(email: string): Promise<void> {
    const c = await this.findCustomerByEmail(email);
    if (c) await this.delete('customer', c.id);
  }

  /** Housekeeping: remove all customers created by the suite (by e-mail prefix). */
  async deleteTestCustomers(emailPrefix: string, emailDomain: string): Promise<number> {
    // page in batches of 100 (some shops cap the API limit)
    let deleted = 0;
    for (;;) {
      const batch = await this.search<{ id: string }>('customer', {
        filter: [
          { type: 'prefix', field: 'email', value: `${emailPrefix}.` },
          { type: 'suffix', field: 'email', value: `@${emailDomain}` },
        ],
        limit: 100,
      });
      if (batch.length === 0) return deleted;
      for (const c of batch) await this.delete('customer', c.id);
      deleted += batch.length;
    }
  }
}
