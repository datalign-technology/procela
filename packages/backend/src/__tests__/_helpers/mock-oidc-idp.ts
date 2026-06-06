import express from 'express';
import { generateKeyPairSync, createPrivateKey, type KeyObject } from 'crypto';
import jwt from 'jsonwebtoken';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// Mock OIDC IdP for integration tests. Stands up a tiny Express app
// that implements just enough of the spec for Procela's
// OidcAuthProvider to drive an end-to-end Authorization Code + PKCE
// flow against it:
//
//   GET  /.well-known/openid-configuration   discovery
//   POST /oauth2/token                       code → id_token + access_token
//   GET  /.well-known/jwks.json              public-key JWKS for id_token verification
//   GET  /oauth2/authorize                   not used (Procela's flow stops at the loginUrl)
//   GET  /oauth2/end_session                 RP-initiated logout endpoint (smoke only)
//
// Tests configure Procela's OIDC provider with this server's base URL
// as the issuer + clientId, then drive the flow through Procela's HTTP
// routes. The mock signs id_tokens with the same key it advertises in
// the JWKS so the JWT verifier inside the OidcAuthProvider passes.

export interface MockOidcIdpHandle {
  /** Base URL — also the `iss` claim baked into id_tokens. */
  url: string;
  /** Single test client. The mock accepts only this client_id. */
  clientId: string;
  /** Mint a signed id_token for the given subject. Tests use this
   *  to seed the token-exchange response without owning the keypair. */
  signIdToken: (claims: Record<string, unknown>) => string;
  /** Register an authorization code that /token will accept and trade
   *  for the given id_token. Returns the code string. */
  expectCodeExchange: (idToken: string) => string;
  /** Shut down the mock server. */
  close: () => Promise<void>;
}

export async function startMockOidcIdp(opts: { clientId?: string } = {}): Promise<MockOidcIdpHandle> {
  const clientId = opts.clientId || 'procela-test-client';
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'mock-oidc-key-1';

  // KeyObject.export({ format: 'jwk' }) yields the JWK we publish at
  // /.well-known/jwks.json. Node 16+ has this built in; no jose dep
  // needed.
  const publicJwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  publicJwk.kid = kid;
  publicJwk.use = 'sig';
  publicJwk.alg = 'RS256';

  // Authorization codes the mock will accept on /token. Each entry
  // expires after a single use to match real IdP semantics.
  const codes = new Map<string, { idToken: string; used: boolean }>();

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  let baseUrl = '';

  app.get('/.well-known/openid-configuration', (_req, res) => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth2/authorize`,
      token_endpoint: `${baseUrl}/oauth2/token`,
      jwks_uri: `${baseUrl}/.well-known/jwks.json`,
      end_session_endpoint: `${baseUrl}/oauth2/end_session`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
    });
  });

  app.get('/.well-known/jwks.json', (_req, res) => {
    res.json({ keys: [publicJwk] });
  });

  app.post('/oauth2/token', (req, res) => {
    const body = req.body as Record<string, string>;
    if (body.grant_type !== 'authorization_code') {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }
    if (body.client_id !== clientId) {
      return res.status(401).json({ error: 'invalid_client' });
    }
    const entry = codes.get(body.code);
    if (!entry) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown code' });
    }
    if (entry.used) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Code already used' });
    }
    entry.used = true;
    res.json({
      id_token: entry.idToken,
      access_token: 'mock-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });

  app.get('/oauth2/end_session', (req, res) => {
    // Echo the post_logout_redirect_uri so a test can confirm the
    // RP-initiated logout reached us.
    const target = String(req.query.post_logout_redirect_uri || baseUrl);
    res.redirect(target);
  });

  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      if (!addr || typeof addr === 'string') return reject(new Error('No address'));
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        url: baseUrl,
        clientId,
        signIdToken: (claims) => signIdToken(privateKey, kid, baseUrl, clientId, claims),
        expectCodeExchange: (idToken) => {
          const code = 'mock-code-' + Math.random().toString(36).slice(2);
          codes.set(code, { idToken, used: false });
          return code;
        },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
    server.on('error', reject);
  });
}

function signIdToken(
  privateKey: KeyObject,
  kid: string,
  issuer: string,
  audience: string,
  claims: Record<string, unknown>,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + 600,
    ...claims,
  };
  // jsonwebtoken accepts a KeyObject directly for RS256 since v9.
  return jwt.sign(payload, createPrivateKey(privateKey.export({ format: 'pem', type: 'pkcs8' })), {
    algorithm: 'RS256',
    keyid: kid,
  });
}
