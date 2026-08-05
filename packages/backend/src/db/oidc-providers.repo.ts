// OidcProvider repository — the multi-IdP registry.
//
// Replaces the in-memory `oidcProviders` Map in services/auth-providers.ts.
// Persists the plain OidcConfig (the running OidcAuthProvider instances are
// reconstructed from it at the call site during the auth cutover, PR 3). Fits
// the standard {id} pattern. `clientSecret` is encrypted at rest by
// services/auth-providers (encryptSecret on persist, decryptSecret on
// hydrate) — the persisted value is an enc:… envelope when a KMS/local key
// is configured. See docs/POSTGRES_CUTOVER_PLAN.md.

import type { OidcConfig } from '../services/auth-providers';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

/** Persisted OIDC provider row — the OidcConfig verbatim. */
export type StoredOidcProvider = OidcConfig;

export function jsonOidcProvidersRepository(store: StoredOidcProvider[]): Repository<StoredOidcProvider> {
  return jsonRepository<StoredOidcProvider>(store, () => saveStore('oidcProviders', store));
}

type PrismaOidcProviderRow = {
  id: string;
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  allowedEmailDomains: string[];
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaOidcProviderDelegate {
  findMany(): Promise<PrismaOidcProviderRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaOidcProviderRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaOidcProviderRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaOidcProviderRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaOidcProviderRow>;
}

function fromPrisma(r: PrismaOidcProviderRow): StoredOidcProvider {
  const cfg: StoredOidcProvider = {
    id: r.id,
    displayName: r.displayName,
    issuer: r.issuer,
    clientId: r.clientId,
    clientSecret: r.clientSecret,
  };
  // Empty scalar list means "no domain scoping" — surface as undefined to
  // match the optional OidcConfig field.
  if (r.allowedEmailDomains.length > 0) cfg.allowedEmailDomains = r.allowedEmailDomains;
  return cfg;
}

function toPrismaData(row: Partial<StoredOidcProvider>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.displayName !== undefined) d.displayName = row.displayName;
  if (row.issuer !== undefined) d.issuer = row.issuer;
  if (row.clientId !== undefined) d.clientId = row.clientId;
  if (row.clientSecret !== undefined) d.clientSecret = row.clientSecret;
  if (row.allowedEmailDomains !== undefined) d.allowedEmailDomains = row.allowedEmailDomains ?? [];
  return d;
}

export function prismaOidcProvidersRepository(
  clientFactory: () => { oidcProvider: PrismaOidcProviderDelegate } =
    getPrisma as unknown as () => { oidcProvider: PrismaOidcProviderDelegate },
): Repository<StoredOidcProvider> {
  return {
    async list() {
      const rows = await clientFactory().oidcProvider.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const row = await clientFactory().oidcProvider.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const created = await clientFactory().oidcProvider.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      try {
        const updated = await clientFactory().oidcProvider.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      try {
        await clientFactory().oidcProvider.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

/**
 * Pick the right OidcProvider repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getOidcProvidersRepository(store: StoredOidcProvider[]): Repository<StoredOidcProvider> {
  return hasDatabase()
    ? prismaOidcProvidersRepository()
    : jsonOidcProvidersRepository(store);
}
