// Tests for services/kms-providers — the AWS / Azure / GCP adapters
// flagged in COVERAGE.md as Tier 1 (46% line, fn cov untouched).
//
// We can't drive the real cloud SDKs from CI — they aren't installed
// in this monorepo and shouldn't be. What we CAN test, and what's
// most likely to silently break, is the surrounding logic:
//
//   - constructor argument validation (missing keyId / url / resource)
//   - decrypt's envelope-prefix guard (rejects a payload encrypted by
//     a different provider so a misconfigured rotation can't silently
//     "succeed" with garbage)
//   - selectKmsProviderFromEnv branching across every choice, including
//     the unknown-choice fall-back and the config-error catch path
//
// The encrypt/decrypt happy paths are exercised by integration in
// real deployments; here we lock in the boundary behaviour.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  AwsKmsProvider,
  AzureKeyVaultProvider,
  GcpKmsProvider,
  selectKmsProviderFromEnv,
} from '../services/kms-providers';

describe('KMS providers', () => {
  describe('constructor validation', () => {
    it('AwsKmsProvider throws without keyId', () => {
      assert.throws(() => new AwsKmsProvider({ keyId: '' }), /AWS_KMS_KEY_ID is required/);
    });
    it('AwsKmsProvider accepts a keyId-only config', () => {
      const p = new AwsKmsProvider({ keyId: 'alias/test' });
      assert.strictEqual(p.name, 'aws-kms');
    });
    it('AzureKeyVaultProvider throws without vaultUrl', () => {
      assert.throws(
        () => new AzureKeyVaultProvider({ vaultUrl: '', keyName: 'k' }),
        /AZURE_KEYVAULT_URL is required/,
      );
    });
    it('AzureKeyVaultProvider throws without keyName', () => {
      assert.throws(
        () => new AzureKeyVaultProvider({ vaultUrl: 'https://v.vault.azure.net', keyName: '' }),
        /AZURE_KEYVAULT_KEY_NAME is required/,
      );
    });
    it('GcpKmsProvider throws without keyResource', () => {
      assert.throws(() => new GcpKmsProvider({ keyResource: '' }), /GCP_KMS_KEY_RESOURCE is required/);
    });
  });

  describe('decrypt envelope-prefix guard', () => {
    it('AWS decrypt rejects a non-aws envelope before touching the SDK', async () => {
      const p = new AwsKmsProvider({ keyId: 'alias/test' });
      await assert.rejects(p.decrypt('enc:azure:v1:abc'), /Not an AWS KMS envelope/);
      await assert.rejects(p.decrypt('plaintext-no-prefix'), /Not an AWS KMS envelope/);
    });
    it('Azure decrypt rejects a non-azure envelope', async () => {
      const p = new AzureKeyVaultProvider({ vaultUrl: 'https://v.vault.azure.net', keyName: 'k' });
      await assert.rejects(p.decrypt('enc:aws:v1:abc'), /Not an Azure KV envelope/);
    });
    it('GCP decrypt rejects a non-gcp envelope', async () => {
      const p = new GcpKmsProvider({ keyResource: 'projects/p/locations/l/keyRings/r/cryptoKeys/k' });
      await assert.rejects(p.decrypt('enc:aws:v1:abc'), /Not a GCP KMS envelope/);
    });
  });

  describe('selectKmsProviderFromEnv', () => {
    // Snapshot every KMS-related env var so each test runs in its
    // own configuration without leaking state to the next.
    const KEYS = [
      'KMS_PROVIDER',
      'AWS_KMS_KEY_ID', 'AWS_KMS_REGION', 'AWS_REGION',
      'AZURE_KEYVAULT_URL', 'AZURE_KEYVAULT_KEY_NAME',
      'GCP_KMS_KEY_RESOURCE',
    ];
    let saved: Record<string, string | undefined>;
    beforeEach(() => {
      saved = {};
      for (const k of KEYS) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
    });
    afterEach(() => {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it('returns null when KMS_PROVIDER is unset', () => {
      assert.strictEqual(selectKmsProviderFromEnv(), null);
    });
    it('returns null when KMS_PROVIDER is "local"', () => {
      process.env.KMS_PROVIDER = 'local';
      assert.strictEqual(selectKmsProviderFromEnv(), null);
    });
    it('returns an AwsKmsProvider when "aws" is set with a valid keyId', () => {
      process.env.KMS_PROVIDER = 'aws';
      process.env.AWS_KMS_KEY_ID = 'alias/procela-mfa';
      const p = selectKmsProviderFromEnv();
      assert.ok(p instanceof AwsKmsProvider);
      assert.strictEqual(p!.name, 'aws-kms');
    });
    it('accepts the alias "aws-kms"', () => {
      process.env.KMS_PROVIDER = 'aws-kms';
      process.env.AWS_KMS_KEY_ID = 'alias/procela-mfa';
      assert.ok(selectKmsProviderFromEnv() instanceof AwsKmsProvider);
    });
    it('returns null when "aws" is set without AWS_KMS_KEY_ID — does not crash', () => {
      process.env.KMS_PROVIDER = 'aws';
      // No AWS_KMS_KEY_ID — constructor throws, selectFromEnv catches.
      assert.strictEqual(selectKmsProviderFromEnv(), null);
    });
    it('returns an AzureKeyVaultProvider when "azure" is set with vault url + key', () => {
      process.env.KMS_PROVIDER = 'azure';
      process.env.AZURE_KEYVAULT_URL = 'https://v.vault.azure.net';
      process.env.AZURE_KEYVAULT_KEY_NAME = 'procela-mfa';
      const p = selectKmsProviderFromEnv();
      assert.ok(p instanceof AzureKeyVaultProvider);
      assert.strictEqual(p!.name, 'azure-kv');
    });
    it('returns null when "azure" is missing required vars', () => {
      process.env.KMS_PROVIDER = 'azure';
      assert.strictEqual(selectKmsProviderFromEnv(), null);
    });
    it('returns a GcpKmsProvider when "gcp" is set with a key resource', () => {
      process.env.KMS_PROVIDER = 'gcp';
      process.env.GCP_KMS_KEY_RESOURCE = 'projects/p/locations/l/keyRings/r/cryptoKeys/k';
      const p = selectKmsProviderFromEnv();
      assert.ok(p instanceof GcpKmsProvider);
      assert.strictEqual(p!.name, 'gcp-kms');
    });
    it('returns null when "gcp" is missing GCP_KMS_KEY_RESOURCE', () => {
      process.env.KMS_PROVIDER = 'gcp';
      assert.strictEqual(selectKmsProviderFromEnv(), null);
    });
    it('returns null for an unknown choice (logs a warn; falls back to local)', () => {
      process.env.KMS_PROVIDER = 'vault';
      assert.strictEqual(selectKmsProviderFromEnv(), null);
    });
  });
});
