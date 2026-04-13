import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveCloudFileUrl, resolveDataWarehouseUrl } from '../services/connector.service';

describe('resolveCloudFileUrl', () => {
  it('builds the S3 virtual-hosted URL for a bucket', () => {
    assert.strictEqual(resolveCloudFileUrl('S3', 'my-bucket'), 'https://my-bucket.s3.amazonaws.com');
  });

  it('builds the Azure Blob URL for a storage account', () => {
    assert.strictEqual(resolveCloudFileUrl('AZURE_BLOB', 'myacct'), 'https://myacct.blob.core.windows.net');
  });

  it('builds the GCS URL for a bucket', () => {
    assert.strictEqual(resolveCloudFileUrl('GCS', 'my-bucket'), 'https://storage.googleapis.com/my-bucket');
  });

  it('returns null for LOCAL or SFTP (handled by other code paths)', () => {
    assert.strictEqual(resolveCloudFileUrl('LOCAL', 'ignored'), null);
    assert.strictEqual(resolveCloudFileUrl('SFTP', 'sftp.example.com'), null);
  });

  it('returns null for unknown storage types', () => {
    assert.strictEqual(resolveCloudFileUrl('WAT', 'b'), null);
    assert.strictEqual(resolveCloudFileUrl(undefined, 'b'), null);
  });
});

describe('resolveDataWarehouseUrl', () => {
  it('auto-completes a bare Snowflake account identifier', () => {
    assert.strictEqual(
      resolveDataWarehouseUrl('SNOWFLAKE', 'org-acct'),
      'https://org-acct.snowflakecomputing.com',
    );
  });

  it('accepts a fully-qualified Snowflake host without double-suffixing', () => {
    assert.strictEqual(
      resolveDataWarehouseUrl('SNOWFLAKE', 'org-acct.snowflakecomputing.com'),
      'https://org-acct.snowflakecomputing.com',
    );
  });

  it('uses the fixed BigQuery endpoint regardless of account value', () => {
    assert.strictEqual(resolveDataWarehouseUrl('BIGQUERY', 'anything'), 'https://bigquery.googleapis.com');
  });

  it('prepends https:// for bare Redshift hosts', () => {
    assert.strictEqual(
      resolveDataWarehouseUrl('REDSHIFT', 'cluster.abc123.us-east-1.redshift.amazonaws.com'),
      'https://cluster.abc123.us-east-1.redshift.amazonaws.com',
    );
  });

  it('preserves an explicit scheme when the account is already a URL', () => {
    assert.strictEqual(
      resolveDataWarehouseUrl('DATABRICKS', 'https://foo.cloud.databricks.com'),
      'https://foo.cloud.databricks.com',
    );
  });

  it('falls back to prepending https:// when no warehouse type matches', () => {
    assert.strictEqual(resolveDataWarehouseUrl(undefined, 'some.host'), 'https://some.host');
  });
});
