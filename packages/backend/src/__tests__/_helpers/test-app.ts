import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// Build a minimal Express app that mounts just the auth router with
// the middleware it needs. Lets integration tests drive the full OIDC
// / SAML flows over real HTTP without booting the production index.ts
// (which binds to PORT and runs every initialization side effect).
//
// Returns a `{ url, close }` handle. The server is bound to an
// ephemeral port so tests can run in parallel without collisions.

import authRouter from '../../routes/auth';

export interface TestAppHandle {
  url: string;
  close: () => Promise<void>;
}

export async function startAuthApp(): Promise<TestAppHandle> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  // SAML's ACS endpoint receives application/x-www-form-urlencoded —
  // the global index.ts wires this; tests need it too.
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use('/api/v1/auth', authRouter);

  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      if (!addr || typeof addr === 'string') return reject(new Error('No address'));
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
    server.on('error', reject);
  });
}
