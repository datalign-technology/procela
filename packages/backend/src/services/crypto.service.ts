import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import logger from '../lib/logger';
import config from '../config';

// ──────────────────────────────────────────────────────────────────────────
// crypto.service — at-rest envelope encryption for sensitive secrets.
//
// First consumer is the MFA / TOTP secret (mfa.service uses HMAC, so
// the raw bytes have to be recoverable — Argon2 wouldn't work). The
// design is forward-compatible with any future "secret on the Person
// record" use case: API tokens, encrypted notes, etc.
//
// Two backends, picked at boot:
//   - local (default): AES-256-GCM with a master key derived from the
//     MFA_ENCRYPTION_KEY env var via scrypt. Self-contained, no
//     external dependency. Adequate for prototypes and small
//     deployments; the trust assumption is "the env file is at least
//     as protected as the data file."
//   - kms (placeholder): swap encrypt/decrypt for AWS KMS / Azure
//     Key Vault / GCP KMS calls. The KmsProvider interface is the
//     extension point; production deployments implement it and
//     register at boot.
//
// Format: encrypted strings start with `enc:v1:` so the read path
// can distinguish ciphertext from plaintext. Legacy plaintext
// secrets (created before this commit) keep working and get upgraded
// to ciphertext on next write. There's no destructive migration.
// ──────────────────────────────────────────────────────────────────────────

export interface KmsProvider {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
  /** Stable identifier emitted on the boot log so the operator can
   *  see at a glance which backend is active. */
  readonly name: string;
}

const CIPHERTEXT_PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// ── Local AES-256-GCM backend ──
// Master key is derived from MFA_ENCRYPTION_KEY via scrypt with a
// fixed salt. The salt being fixed is OK here because the key itself
// is the secret; scrypt protects against weak-key brute-force from a
// short MFA_ENCRYPTION_KEY value (like "password").

class LocalAesProvider implements KmsProvider {
  readonly name = 'local-aes-256-gcm';
  private readonly key: Buffer;

  constructor(keyMaterial: string) {
    // 16-byte fixed salt. Production should rotate by re-encrypting
    // every record with a new key — out of scope here.
    const salt = Buffer.from('procela-mfa-key-salt-v1', 'utf-8');
    this.key = scryptSync(keyMaterial, salt, KEY_LENGTH);
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Wire format: enc:v1:<iv>.<tag>.<ciphertext> — all base64url
    // (URL-safe so the encoded value drops cleanly into env / JSON
    // / shell logs without escaping).
    return `${CIPHERTEXT_PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
  }

  async decrypt(ciphertext: string): Promise<string> {
    if (!ciphertext.startsWith(CIPHERTEXT_PREFIX)) {
      throw new Error('Not a v1 ciphertext envelope');
    }
    const parts = ciphertext.slice(CIPHERTEXT_PREFIX.length).split('.');
    if (parts.length !== 3) throw new Error('Malformed ciphertext envelope');
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const enc = Buffer.from(parts[2], 'base64url');
    if (iv.length !== IV_LENGTH) throw new Error('Bad IV length');
    if (tag.length !== TAG_LENGTH) throw new Error('Bad auth-tag length');
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf-8');
  }
}

// ── No-op backend ──
// When MFA_ENCRYPTION_KEY is not set in dev, secrets pass through
// unchanged. Production refuses to start in this state via the
// readiness check in index.ts — this fallback exists only so a
// local dev environment that's never touched MFA doesn't fail to
// boot. The pass-through is detectable: the stored secret stays in
// the legacy base32 form rather than the enc:v1: envelope.

class NoOpProvider implements KmsProvider {
  readonly name = 'noop-passthrough';
  async encrypt(plaintext: string): Promise<string> { return plaintext; }
  async decrypt(ciphertext: string): Promise<string> { return ciphertext; }
}

// ── Selection ──
// Priority:
//   1. KMS_PROVIDER env (aws-kms / azure-kv / gcp-kms) — cloud KMS
//      activates when the matching SDK is installed and the per-
//      provider config (key id, vault url, etc.) is present.
//   2. MFA_ENCRYPTION_KEY env — local AES-256-GCM with a scrypt-
//      derived key. Self-contained, no external dep. Good for
//      prototypes and small deployments.
//   3. Nothing set — no-op passthrough. Logs a warning; the
//      production readiness check surfaces this loudly at boot.

let provider: KmsProvider;

// The KMS selector lives in a separate module (kms-providers.ts) so
// the SDKs only get pulled in when the user actually picks a cloud
// provider. Imported here as a function call rather than a module
// import to keep the dependency graph lazy.
import { selectKmsProviderFromEnv } from './kms-providers';

const cloudProvider = selectKmsProviderFromEnv();
if (cloudProvider) {
  provider = cloudProvider;
  logger.info({ backend: provider.name }, 'Crypto service: at-rest encryption ENABLED (cloud KMS)');
} else {
  const keyMaterial = process.env.MFA_ENCRYPTION_KEY || '';
  if (keyMaterial) {
    if (keyMaterial.length < 16) {
      logger.warn({ length: keyMaterial.length }, 'MFA_ENCRYPTION_KEY is shorter than 16 chars — recommend a longer value');
    }
    provider = new LocalAesProvider(keyMaterial);
    logger.info({ backend: provider.name }, 'Crypto service: at-rest encryption ENABLED (local AES)');
  } else {
    provider = new NoOpProvider();
    // Production-readiness check in index.ts surfaces this as a
    // warning at boot; here we just log it once so any test or local
    // run notices.
    logger.warn('Crypto service: no encryption configured (KMS_PROVIDER and MFA_ENCRYPTION_KEY both unset) — secrets stored in plaintext');
  }
}

/** Register a custom KMS provider (e.g. AWS KMS, Azure Key Vault).
 *  Call once at boot before any encrypt/decrypt traffic. The
 *  provider replaces the default; existing ciphertexts MUST decrypt
 *  cleanly under the new provider or be migrated. */
export function setKmsProvider(p: KmsProvider): void {
  provider = p;
  logger.info({ backend: provider.name }, 'Crypto service: provider replaced');
}

export function getKmsProvider(): KmsProvider {
  return provider;
}

/** Encrypt a string. Returns the wire-format envelope when a real
 *  provider is configured; passes through unchanged in dev with no
 *  key set. */
export async function encryptSecret(plaintext: string): Promise<string> {
  return provider.encrypt(plaintext);
}

/** Decrypt a string. Routes by envelope prefix so a record encrypted
 *  by one provider can still be decrypted after the operator
 *  switches providers (as long as the previous provider's SDK +
 *  config are still available). Legacy plaintext (no envelope
 *  prefix) passes through unchanged so records that predate at-rest
 *  encryption keep working until they're rewritten.
 *
 *  Known prefixes:
 *    enc:v1:      legacy local AES-GCM (this file's LocalAesProvider)
 *    enc:aws:v1:  AWS KMS native ciphertext
 *    enc:azure:v1: Azure Key Vault native ciphertext
 *    enc:gcp:v1:  GCP KMS native ciphertext
 *
 *  No prefix → plaintext / legacy. */
export async function decryptSecret(maybeCiphertext: string): Promise<string> {
  if (!maybeCiphertext.includes(':')) return maybeCiphertext;
  if (maybeCiphertext.startsWith(CIPHERTEXT_PREFIX)) return provider.decrypt(maybeCiphertext);
  // Cloud-KMS envelopes — the active provider may already be the
  // right one (preferred path); if not, lazy-construct a sibling
  // provider just for decrypt so we can read the record without a
  // re-encryption migration.
  if (maybeCiphertext.startsWith('enc:aws:v1:')) {
    if (provider.name === 'aws-kms') return provider.decrypt(maybeCiphertext);
    return decryptViaTemporaryProvider('aws', maybeCiphertext);
  }
  if (maybeCiphertext.startsWith('enc:azure:v1:')) {
    if (provider.name === 'azure-kv') return provider.decrypt(maybeCiphertext);
    return decryptViaTemporaryProvider('azure', maybeCiphertext);
  }
  if (maybeCiphertext.startsWith('enc:gcp:v1:')) {
    if (provider.name === 'gcp-kms') return provider.decrypt(maybeCiphertext);
    return decryptViaTemporaryProvider('gcp', maybeCiphertext);
  }
  // Unknown prefix — return as-is rather than throwing; the
  // failure surfaces at the caller (e.g. "Invalid code" on MFA
  // verify) instead of crashing the whole route.
  return maybeCiphertext;
}

async function decryptViaTemporaryProvider(kind: 'aws' | 'azure' | 'gcp', ciphertext: string): Promise<string> {
  // We only need to decrypt — no need to register globally. Lazy
  // import + lazy construct keeps the dep graph clean for installs
  // that only ever use one provider.
  const { AwsKmsProvider, AzureKeyVaultProvider, GcpKmsProvider } = await import('./kms-providers');
  if (kind === 'aws') {
    const p = new AwsKmsProvider({
      keyId: process.env.AWS_KMS_KEY_ID || '',
      region: process.env.AWS_KMS_REGION || process.env.AWS_REGION || undefined,
    });
    return p.decrypt(ciphertext);
  }
  if (kind === 'azure') {
    const p = new AzureKeyVaultProvider({
      vaultUrl: process.env.AZURE_KEYVAULT_URL || '',
      keyName: process.env.AZURE_KEYVAULT_KEY_NAME || '',
    });
    return p.decrypt(ciphertext);
  }
  const p = new GcpKmsProvider({
    keyResource: process.env.GCP_KMS_KEY_RESOURCE || '',
  });
  return p.decrypt(ciphertext);
}

/** Whether at-rest encryption is active. Used by the readiness
 *  check to warn on production deployments that haven't set
 *  MFA_ENCRYPTION_KEY. */
export function isEncryptionConfigured(): boolean {
  return provider.name !== 'noop-passthrough';
}

void config; // referenced for parity with other services; kept so an
             // env-driven backend selector can be added later.
