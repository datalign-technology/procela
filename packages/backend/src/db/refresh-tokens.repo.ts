// RefreshToken repository — the session / refresh-token store.
//
// Replaces the in-memory `validRefreshTokens` Map in routes/auth.ts. Keyed by
// the token's jti (not an `id`), so it exposes the verbs auth actually needs:
// list (for /auth/sessions and SLO matching), get, upsert, remove. See
// docs/POSTGRES_CUTOVER_PLAN.md (PR 2). No consumer is wired yet.

import { saveStore } from '../lib/persistence';
import { getPrisma, hasDatabase } from './prisma';

/** Persisted refresh-token row — the jti plus the RefreshTokenContext fields
 *  from routes/auth.ts, kept verbatim so the auth cutover (PR 3) is a
 *  straight Map→repo swap. */
export interface StoredRefreshToken {
  jti: string;
  personId?: string;
  oidcProviderId?: string;
  oidcIdToken?: string;
  samlNameID?: string;
  samlSessionIndex?: string;
  ip?: string;
  userAgent?: string;
  createdAt?: string;
  lastUsedAt?: string;
}

export interface RefreshTokenRepository {
  /** All active tokens — auth iterates these for /auth/sessions and SLO. */
  list(): Promise<StoredRefreshToken[]>;
  /** One token by jti, or null if unknown/revoked. */
  get(jti: string): Promise<StoredRefreshToken | null>;
  /** Create or replace a token by jti. */
  upsert(token: StoredRefreshToken): Promise<void>;
  /** Revoke a token. Returns true if one was removed. */
  remove(jti: string): Promise<boolean>;
}

export function jsonRefreshTokensRepository(store: StoredRefreshToken[]): RefreshTokenRepository {
  return {
    async list() {
      return [...store];
    },
    async get(jti) {
      return store.find((t) => t.jti === jti) ?? null;
    },
    async upsert(token) {
      const i = store.findIndex((t) => t.jti === token.jti);
      if (i >= 0) store[i] = token;
      else store.push(token);
      saveStore('refreshTokens', store);
    },
    async remove(jti) {
      const i = store.findIndex((t) => t.jti === jti);
      if (i < 0) return false;
      store.splice(i, 1);
      saveStore('refreshTokens', store);
      return true;
    },
  };
}

type PrismaRefreshTokenRow = {
  jti: string;
  personId: string | null;
  oidcProviderId: string | null;
  oidcIdToken: string | null;
  samlNameID: string | null;
  samlSessionIndex: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
};

export interface PrismaRefreshTokenDelegate {
  findMany(): Promise<PrismaRefreshTokenRow[]>;
  findUnique(arg: { where: { jti: string } }): Promise<PrismaRefreshTokenRow | null>;
  upsert(arg: {
    where: { jti: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<PrismaRefreshTokenRow>;
  delete(arg: { where: { jti: string } }): Promise<PrismaRefreshTokenRow>;
}

/** Drop null columns to `undefined` so the row matches StoredRefreshToken. */
function fromPrisma(r: PrismaRefreshTokenRow): StoredRefreshToken {
  const out: StoredRefreshToken = { jti: r.jti };
  if (r.personId !== null) out.personId = r.personId;
  if (r.oidcProviderId !== null) out.oidcProviderId = r.oidcProviderId;
  if (r.oidcIdToken !== null) out.oidcIdToken = r.oidcIdToken;
  if (r.samlNameID !== null) out.samlNameID = r.samlNameID;
  if (r.samlSessionIndex !== null) out.samlSessionIndex = r.samlSessionIndex;
  if (r.ip !== null) out.ip = r.ip;
  if (r.userAgent !== null) out.userAgent = r.userAgent;
  if (r.createdAt !== null) out.createdAt = r.createdAt;
  if (r.lastUsedAt !== null) out.lastUsedAt = r.lastUsedAt;
  return out;
}

function toPrismaData(t: StoredRefreshToken): Record<string, unknown> {
  return {
    jti: t.jti,
    personId: t.personId ?? null,
    oidcProviderId: t.oidcProviderId ?? null,
    oidcIdToken: t.oidcIdToken ?? null,
    samlNameID: t.samlNameID ?? null,
    samlSessionIndex: t.samlSessionIndex ?? null,
    ip: t.ip ?? null,
    userAgent: t.userAgent ?? null,
    createdAt: t.createdAt ?? null,
    lastUsedAt: t.lastUsedAt ?? null,
  };
}

export function prismaRefreshTokensRepository(
  clientFactory: () => { refreshToken: PrismaRefreshTokenDelegate } =
    getPrisma as unknown as () => { refreshToken: PrismaRefreshTokenDelegate },
): RefreshTokenRepository {
  return {
    async list() {
      const rows = await clientFactory().refreshToken.findMany();
      return rows.map(fromPrisma);
    },
    async get(jti) {
      const row = await clientFactory().refreshToken.findUnique({ where: { jti } });
      return row ? fromPrisma(row) : null;
    },
    async upsert(token) {
      const data = toPrismaData(token);
      await clientFactory().refreshToken.upsert({ where: { jti: token.jti }, create: data, update: data });
    },
    async remove(jti) {
      try {
        await clientFactory().refreshToken.delete({ where: { jti } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

/**
 * Pick the right RefreshToken repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getRefreshTokensRepository(store: StoredRefreshToken[]): RefreshTokenRepository {
  return hasDatabase()
    ? prismaRefreshTokensRepository()
    : jsonRefreshTokensRepository(store);
}
