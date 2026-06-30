import logger from '../lib/logger';
import type { KmsProvider } from './crypto.service';

// ──────────────────────────────────────────────────────────────────────────
// kms-providers — adapter implementations for cloud KMS services.
//
// Three providers ship behind one interface; the SDKs are dynamically
// imported on first use so a deployment that picks "aws" doesn't need
// the Azure or GCP SDKs installed, and vice versa. When the chosen
// provider's SDK isn't present, the constructor throws with a clear
// install hint — the boot path falls back to local AES + a warning
// rather than crashing.
//
// Wire format per provider:
//
//   AWS KMS    enc:aws:v1:<base64url-ciphertext>
//   Azure KV   enc:azure:v1:<base64url-ciphertext>
//   GCP KMS    enc:gcp:v1:<base64url-ciphertext>
//
// Each provider uses its native ciphertext blob — there's no
// envelope layer here because the secrets we encrypt (TOTP keys ~20
// bytes, future API tokens ~32 bytes) fit comfortably inside the
// KMS per-call ciphertext limits (4 KB for AWS, similar elsewhere).
// Switching providers requires re-encryption — a migration story
// that's out of scope for this commit. Operators rotate by setting
// the new provider, then bulk-rewriting affected records.
//
// Configuration via env (only one set is read based on KMS_PROVIDER):
//
//   AWS:    AWS_KMS_KEY_ID            arn or alias (alias/procela-mfa)
//           AWS_KMS_REGION            optional, defaults to AWS SDK chain
//           AWS_ACCESS_KEY_ID / SECRET_ACCESS_KEY — picked up via SDK chain
//
//   Azure:  AZURE_KEYVAULT_URL        https://my-vault.vault.azure.net
//           AZURE_KEYVAULT_KEY_NAME   name of the AES key inside
//           AZURE credentials picked up by DefaultAzureCredential
//
//   GCP:    GCP_KMS_KEY_RESOURCE      projects/X/locations/Y/keyRings/Z/cryptoKeys/W
//           GOOGLE_APPLICATION_CREDENTIALS — picked up by the SDK
// ──────────────────────────────────────────────────────────────────────────

// ── AWS KMS ──

export class AwsKmsProvider implements KmsProvider {
  readonly name = 'aws-kms';
  private clientPromise: Promise<any> | null = null;
  private readonly keyId: string;
  private readonly region: string | undefined;

  constructor(opts: { keyId: string; region?: string }) {
    if (!opts.keyId) throw new Error('AWS_KMS_KEY_ID is required for the aws-kms provider');
    this.keyId = opts.keyId;
    this.region = opts.region;
  }

  private async sdk(): Promise<any> {
    try {
      // Constructed-string spec so TypeScript can't statically
      // resolve and complain when the optional SDK isn't installed.
      return await import(/* @vite-ignore */ '@aws-sdk' + '/client-kms');
    } catch {
      throw new Error('@aws-sdk/client-kms is not installed. Run `npm install @aws-sdk/client-kms` in packages/backend.');
    }
  }

  private async getClient(): Promise<any> {
    if (this.clientPromise) return this.clientPromise;
    this.clientPromise = (async () => {
      const mod = await this.sdk();
      return new mod.KMSClient({ ...(this.region ? { region: this.region } : {}) });
    })();
    return this.clientPromise;
  }

  async encrypt(plaintext: string): Promise<string> {
    const client = await this.getClient();
    const mod = await this.sdk();
    const cmd = new mod.EncryptCommand({
      KeyId: this.keyId,
      Plaintext: new TextEncoder().encode(plaintext),
    });
    const res = await client.send(cmd);
    const blob = Buffer.from(res.CiphertextBlob as Uint8Array).toString('base64url');
    return `enc:aws:v1:${blob}`;
  }

  async decrypt(envelope: string): Promise<string> {
    if (!envelope.startsWith('enc:aws:v1:')) throw new Error('Not an AWS KMS envelope');
    const blob = envelope.slice('enc:aws:v1:'.length);
    const client = await this.getClient();
    const mod = await this.sdk();
    const cmd = new mod.DecryptCommand({
      CiphertextBlob: Buffer.from(blob, 'base64url'),
      KeyId: this.keyId,
    });
    const res = await client.send(cmd);
    return Buffer.from(res.Plaintext as Uint8Array).toString('utf-8');
  }
}

// ── Azure Key Vault ──
// Uses Azure Key Vault's CryptographyClient against an RSA key — the
// standard tier supports RSA + EC, not raw AES (that needs Managed
// HSM). RSA-OAEP-256 covers our payload sizes (max ~190 bytes for a
// 2048-bit key; TOTP secrets are 20 bytes).

export class AzureKeyVaultProvider implements KmsProvider {
  readonly name = 'azure-kv';
  private cryptoClientPromise: Promise<any> | null = null;
  private readonly vaultUrl: string;
  private readonly keyName: string;

  constructor(opts: { vaultUrl: string; keyName: string }) {
    if (!opts.vaultUrl) throw new Error('AZURE_KEYVAULT_URL is required for the azure-kv provider');
    if (!opts.keyName) throw new Error('AZURE_KEYVAULT_KEY_NAME is required for the azure-kv provider');
    this.vaultUrl = opts.vaultUrl;
    this.keyName = opts.keyName;
  }

  private async sdk(): Promise<{ keys: any; identity: any }> {
    try {
      const keys = await import(/* @vite-ignore */ '@azure' + '/keyvault-keys');
      const identity = await import(/* @vite-ignore */ '@azure' + '/identity');
      return { keys, identity };
    } catch {
      throw new Error('@azure/keyvault-keys and @azure/identity are not installed. Run `npm install @azure/keyvault-keys @azure/identity` in packages/backend.');
    }
  }

  private async getClient(): Promise<any> {
    if (this.cryptoClientPromise) return this.cryptoClientPromise;
    this.cryptoClientPromise = (async () => {
      const { keys: keysMod, identity: idMod } = await this.sdk();
      const credential = new idMod.DefaultAzureCredential();
      const keyClient = new keysMod.KeyClient(this.vaultUrl, credential);
      const key = await keyClient.getKey(this.keyName);
      return new keysMod.CryptographyClient(key, credential);
    })();
    return this.cryptoClientPromise;
  }

  async encrypt(plaintext: string): Promise<string> {
    const client = await this.getClient();
    const res = await client.encrypt({ algorithm: 'RSA-OAEP-256', plaintext: Buffer.from(plaintext, 'utf-8') });
    const blob = Buffer.from(res.result).toString('base64url');
    return `enc:azure:v1:${blob}`;
  }

  async decrypt(envelope: string): Promise<string> {
    if (!envelope.startsWith('enc:azure:v1:')) throw new Error('Not an Azure KV envelope');
    const blob = envelope.slice('enc:azure:v1:'.length);
    const client = await this.getClient();
    const res = await client.decrypt({ algorithm: 'RSA-OAEP-256', ciphertext: Buffer.from(blob, 'base64url') });
    return Buffer.from(res.result).toString('utf-8');
  }
}

// ── GCP KMS ──

export class GcpKmsProvider implements KmsProvider {
  readonly name = 'gcp-kms';
  private clientPromise: Promise<any> | null = null;
  private readonly keyResource: string;

  constructor(opts: { keyResource: string }) {
    if (!opts.keyResource) throw new Error('GCP_KMS_KEY_RESOURCE is required for the gcp-kms provider');
    this.keyResource = opts.keyResource;
  }

  private async sdk(): Promise<any> {
    try {
      return await import(/* @vite-ignore */ '@google-cloud' + '/kms');
    } catch {
      throw new Error('@google-cloud/kms is not installed. Run `npm install @google-cloud/kms` in packages/backend.');
    }
  }

  private async getClient(): Promise<any> {
    if (this.clientPromise) return this.clientPromise;
    this.clientPromise = (async () => {
      const mod = await this.sdk();
      return new mod.KeyManagementServiceClient();
    })();
    return this.clientPromise;
  }

  async encrypt(plaintext: string): Promise<string> {
    const client = await this.getClient();
    const [res] = await client.encrypt({
      name: this.keyResource,
      plaintext: Buffer.from(plaintext, 'utf-8'),
    });
    const blob = Buffer.from(res.ciphertext as Uint8Array).toString('base64url');
    return `enc:gcp:v1:${blob}`;
  }

  async decrypt(envelope: string): Promise<string> {
    if (!envelope.startsWith('enc:gcp:v1:')) throw new Error('Not a GCP KMS envelope');
    const blob = envelope.slice('enc:gcp:v1:'.length);
    const client = await this.getClient();
    const [res] = await client.decrypt({
      name: this.keyResource,
      ciphertext: Buffer.from(blob, 'base64url'),
    });
    return Buffer.from(res.plaintext as Uint8Array).toString('utf-8');
  }
}

// ── Selection ──
// Reads env at boot and returns the matching provider, or null when
// none is configured (caller falls back to the local AES provider).
// Construction failures (missing required env var) are logged once;
// the boot path doesn't crash.

export function selectKmsProviderFromEnv(): KmsProvider | null {
  const choice = (process.env.KMS_PROVIDER || '').toLowerCase().trim();
  if (!choice || choice === 'local') return null;

  try {
    switch (choice) {
      case 'aws':
      case 'aws-kms':
        return new AwsKmsProvider({
          keyId: process.env.AWS_KMS_KEY_ID || '',
          region: process.env.AWS_KMS_REGION || process.env.AWS_REGION || undefined,
        });
      case 'azure':
      case 'azure-kv':
        return new AzureKeyVaultProvider({
          vaultUrl: process.env.AZURE_KEYVAULT_URL || '',
          keyName: process.env.AZURE_KEYVAULT_KEY_NAME || '',
        });
      case 'gcp':
      case 'gcp-kms':
        return new GcpKmsProvider({
          keyResource: process.env.GCP_KMS_KEY_RESOURCE || '',
        });
      default:
        logger.warn({ choice }, 'Unknown KMS_PROVIDER; falling back to local');
        return null;
    }
  } catch (err: any) {
    logger.warn({ err: err?.message, choice }, 'KMS provider configuration error; falling back to local AES');
    return null;
  }
}
