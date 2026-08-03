import { describe, it } from 'node:test';
import assert from 'node:assert';

import { buildMssqlConfig } from '../sqlserver';

// node-mssql only parses the classic ADO connection string; the
// mssql://… URL form the source type documents must be converted to a
// config object first (see buildMssqlConfig). These pure tests pin that
// conversion; the live-DB integration test proves it actually connects.
describe('sqlserver — buildMssqlConfig', () => {
  it('passes an ADO-style connection string straight through', () => {
    const ado = 'Server=db,1433;Database=app;User Id=ro;Password=pw;Encrypt=true';
    assert.strictEqual(buildMssqlConfig(ado), ado);
  });

  it('converts the mssql:// URL form into a driver config object', () => {
    const cfg = buildMssqlConfig('mssql://ro:pw@db.internal:1433/app?encrypt=true');
    assert.deepStrictEqual(cfg, {
      server: 'db.internal',
      port: 1433,
      user: 'ro',
      password: 'pw',
      database: 'app',
      options: { encrypt: true, trustServerCertificate: false },
    });
  });

  it('also accepts the sqlserver:// scheme', () => {
    const cfg = buildMssqlConfig('sqlserver://ro:pw@db:1433/app');
    assert.strictEqual(typeof cfg, 'object');
    assert.strictEqual((cfg as { server: string }).server, 'db');
  });

  it('defaults the port to 1433 when omitted', () => {
    const cfg = buildMssqlConfig('mssql://ro:pw@db/app') as { port: number };
    assert.strictEqual(cfg.port, 1433);
  });

  it('is secure by default — encrypt on unless the URL disables it', () => {
    const on = buildMssqlConfig('mssql://ro:pw@db/app') as { options: { encrypt: boolean } };
    assert.strictEqual(on.options.encrypt, true);
    const off = buildMssqlConfig('mssql://ro:pw@db/app?encrypt=false') as { options: { encrypt: boolean } };
    assert.strictEqual(off.options.encrypt, false);
  });

  it('honours trustServerCertificate=true (self-signed dev/CI certs)', () => {
    const cfg = buildMssqlConfig('mssql://ro:pw@db/app?encrypt=false&trustServerCertificate=true') as {
      options: { trustServerCertificate: boolean };
    };
    assert.strictEqual(cfg.options.trustServerCertificate, true);
  });

  it('percent-decodes credentials with special characters', () => {
    const cfg = buildMssqlConfig('mssql://u:p%40ss%2Fword@db/app') as { user: string; password: string };
    assert.strictEqual(cfg.password, 'p@ss/word');
  });

  it('tolerates a URL with no database path', () => {
    const cfg = buildMssqlConfig('mssql://ro:pw@db:1433') as unknown as Record<string, unknown>;
    assert.strictEqual('database' in cfg, false, 'no empty database key');
    assert.strictEqual(cfg.server, 'db');
  });

  it('throws a clear error on a malformed URL', () => {
    assert.throws(() => buildMssqlConfig('mssql://'), /invalid SQL Server connectionString/);
  });
});
