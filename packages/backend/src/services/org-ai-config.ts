// Per-tenant AI provider configuration (multi-vendor, phase 3).
//
// Lets each organization run Procela's AI features on its own model vendor
// and key, overriding the deployment-level default (AI_PROVIDER + env). The
// config is stored per-org in the generic AppSetting key/value store under a
// namespaced key — deliberately NOT on the Organization record, so the
// encrypted API key never rides along in the widely-returned org read paths.
//
// The API key is encrypted at rest with the same crypto service that protects
// connection credentials, dbt tokens, OIDC secrets, and TOTP secrets
// (MFA_ENCRYPTION_KEY / a KMS provider; plaintext passthrough only when
// nothing is configured, which the boot readiness check warns about).
//
// Resolution precedence for a given org's AI call (see getAiServiceForOrg in
// ai.service.ts): the org's config when it names a provider and is enabled →
// otherwise the deployment default. A model-only override without a provider
// is intentionally NOT a per-org knob here — that's what the deployment-level
// Settings → AI override covers.

import { settingsRepo } from '../stores/app-settings';
import { encryptSecret, decryptSecret } from './crypto.service';
import { normalizeProviderName, type ProviderCredentials, type KnownProvider } from './llm-provider';

/** The stored shape (persisted). `apiKeyEnc` is the crypto envelope, never
 *  returned to clients. `provider` unset (or `enabled: false`) means "use the
 *  deployment default". */
interface StoredOrgAiConfig {
  provider?: KnownProvider;
  model?: string;
  baseUrl?: string;
  region?: string;
  apiKeyEnc?: string;
  enabled?: boolean;
  updatedAt?: string;
  updatedBy?: string | null;
}

/** The safe view returned by the API — the key is reduced to a boolean. */
export interface OrgAiConfigView {
  provider: KnownProvider | null;
  model: string | null;
  baseUrl: string | null;
  region: string | null;
  enabled: boolean;
  /** True when a per-org API key is stored — the key value itself is never
   *  exposed. */
  apiKeyConfigured: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** A patch from the API. `undefined` leaves a field unchanged; `null`/empty
 *  clears it. For `apiKey`, a non-empty string is encrypted and stored; `''`
 *  or `null` clears the stored key. */
export interface OrgAiConfigPatch {
  provider?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  region?: string | null;
  apiKey?: string | null;
  enabled?: boolean;
}

const keyFor = (orgId: string): string => `aiConfig:${orgId}`;

async function getStored(orgId: string): Promise<StoredOrgAiConfig | null> {
  return settingsRepo.get<StoredOrgAiConfig>(keyFor(orgId));
}

function toView(c: StoredOrgAiConfig | null): OrgAiConfigView {
  return {
    provider: c?.provider ?? null,
    model: c?.model ?? null,
    baseUrl: c?.baseUrl ?? null,
    region: c?.region ?? null,
    enabled: c?.enabled ?? true,
    apiKeyConfigured: !!c?.apiKeyEnc,
    updatedAt: c?.updatedAt ?? null,
    updatedBy: c?.updatedBy ?? null,
  };
}

export async function getOrgAiConfigView(orgId: string): Promise<OrgAiConfigView> {
  return toView(await getStored(orgId));
}

/** Validation outcome for a provider name in a patch. */
export class OrgAiConfigError extends Error {}

/**
 * Apply a patch to an org's AI config, encrypting a supplied key. Returns the
 * safe view. Throws OrgAiConfigError on an unknown provider name so the route
 * can answer 400.
 */
export async function setOrgAiConfig(
  orgId: string,
  patch: OrgAiConfigPatch,
  updatedBy: string | null,
): Promise<OrgAiConfigView> {
  const existing = (await getStored(orgId)) ?? {};
  const next: StoredOrgAiConfig = { ...existing };

  if (patch.provider !== undefined) {
    if (patch.provider === null || patch.provider === '') {
      next.provider = undefined;
    } else {
      const canonical = normalizeProviderName(patch.provider);
      if (!canonical) {
        throw new OrgAiConfigError(`Unknown provider "${patch.provider}". Use one of: anthropic, openai, gemini, bedrock.`);
      }
      next.provider = canonical;
    }
  }
  const trimOrClear = (v: string | null | undefined): string | undefined =>
    v === undefined ? undefined : (v && v.trim() ? v.trim() : undefined);
  if (patch.model !== undefined) next.model = trimOrClear(patch.model);
  if (patch.baseUrl !== undefined) next.baseUrl = trimOrClear(patch.baseUrl);
  if (patch.region !== undefined) next.region = trimOrClear(patch.region);
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.apiKey !== undefined) {
    if (patch.apiKey && patch.apiKey.trim()) {
      next.apiKeyEnc = await encryptSecret(patch.apiKey.trim());
    } else {
      delete next.apiKeyEnc;
    }
  }
  next.updatedAt = new Date().toISOString();
  next.updatedBy = updatedBy;
  await settingsRepo.set(keyFor(orgId), next, updatedBy);
  return toView(next);
}

/** What the resolution path needs to build a provider bound to an org. */
export interface ResolvedOrgProvider {
  provider: KnownProvider;
  /** The org's chosen model, or undefined to fall back to the provider default. */
  model?: string;
  creds: ProviderCredentials;
}

/**
 * Resolve an org's active provider config for a real AI call, decrypting the
 * key. Returns null when the org has no usable config (no provider, or
 * disabled) — the caller then uses the deployment default.
 */
export async function resolveOrgProvider(orgId: string): Promise<ResolvedOrgProvider | null> {
  const c = await getStored(orgId);
  if (!c || c.enabled === false || !c.provider) return null;
  const creds: ProviderCredentials = {};
  if (c.apiKeyEnc) creds.apiKey = await decryptSecret(c.apiKeyEnc);
  if (c.baseUrl) creds.baseUrl = c.baseUrl;
  if (c.region) creds.region = c.region;
  return { provider: c.provider, model: c.model, creds };
}
