import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';
import { people, type StoredPerson } from './people';
import { saveStore } from '../lib/persistence';

// ──────────────────────────────────────────────────────────────────────────
// SCIM 2.0 — push provisioning endpoint.
//
// Lets an enterprise IdP (Microsoft Entra, Okta, OneLogin, Google
// Workspace) push user lifecycle events into Procela: create on hire,
// patch on role change, deactivate on offboarding. Without this an
// admin has to keep a People CSV in sync by hand.
//
// Spec: RFC 7644 (SCIM 2.0 Protocol) + RFC 7643 (Core Schema).
// Mounted under /scim/v2/ per spec convention (not under /api/v1).
//
// What's implemented:
//   GET  /Users              list + filter (eq on userName / email)
//   POST /Users              create
//   GET  /Users/:id          read
//   PUT  /Users/:id          replace
//   PATCH /Users/:id         partial update — supports the common
//                            "active → false" deactivate operation
//                            that IdPs send on offboarding
//   DELETE /Users/:id        delete
//   GET  /ServiceProviderConfig  capability discovery
//   GET  /ResourceTypes      what resources we expose
//   GET  /Schemas            schema introspection
//
// Authentication:
//   Bearer token configured via SCIM_BEARER_TOKEN env var. Token
//   value is opaque — generate a long random string and paste it
//   into both Procela's env and the IdP's SCIM provisioning config.
//   When unset, every SCIM request returns 401 so a half-deployed
//   instance can't be accessed.
//
// Out of scope for this commit:
//   - Group provisioning (Procela doesn't model "groups" the way SCIM
//     expects; the closest analogue is governance-groups which is a
//     deeper modelling question). IdPs that require Groups will 404
//     on that endpoint — most will tolerate that.
//   - Complex filter expressions (only eq is supported; "and" / "or"
//     / "co" / "sw" return 400). Both Entra and Okta default to
//     simple userName eq filters which work today.
//   - PATCH with operations on multi-valued attributes (emails,
//     phoneNumbers). Single-value attribute replace is supported.
// ──────────────────────────────────────────────────────────────────────────

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

interface ScimUser {
  schemas: string[];
  id: string;
  userName: string;
  active: boolean;
  name: {
    givenName?: string;
    familyName?: string;
    formatted?: string;
  };
  displayName?: string;
  emails: Array<{ value: string; primary?: boolean; type?: string }>;
  meta: {
    resourceType: 'User';
    created: string;
    lastModified: string;
    location: string;
  };
}

// ── Bearer auth middleware ──
function scimAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.SCIM_BEARER_TOKEN;
  if (!expected) {
    res.status(401).type('application/scim+json').json({
      schemas: [SCIM_ERROR_SCHEMA],
      status: '401',
      detail: 'SCIM provisioning not configured — set SCIM_BEARER_TOKEN to enable',
    });
    return;
  }
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token !== expected) {
    res.status(401).type('application/scim+json').json({
      schemas: [SCIM_ERROR_SCHEMA],
      status: '401',
      detail: 'Invalid or missing bearer token',
    });
    return;
  }
  next();
}

function scimError(res: Response, status: number, detail: string): void {
  res.status(status).type('application/scim+json').json({
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    detail,
  });
}

function toScimUser(p: StoredPerson, baseUrl: string): ScimUser {
  const [given, ...rest] = (p.name || '').split(' ');
  const family = rest.join(' ');
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: p.id,
    userName: p.email,
    active: true,
    name: {
      givenName: given || undefined,
      familyName: family || undefined,
      formatted: p.name,
    },
    displayName: p.name,
    emails: [{ value: p.email, primary: true, type: 'work' }],
    meta: {
      resourceType: 'User',
      created: p.createdAt,
      lastModified: p.updatedAt,
      location: `${baseUrl}/Users/${p.id}`,
    },
  };
}

function baseUrlFor(req: Request): string {
  return `${req.protocol}://${req.get('host')}/scim/v2`;
}

// ── Filter parser ──
// Supports only `<attr> eq "<value>"`. Spec allows much more (and,
// or, contains, starts-with, complex value selectors) but Entra and
// Okta default to simple userName/email equality which is what 99%
// of provisioning traffic looks like.
function parseFilter(filter?: string): { attr: string; value: string } | null {
  if (!filter) return null;
  const m = filter.match(/^\s*([\w.]+)\s+eq\s+"([^"]+)"\s*$/i);
  if (!m) return null;
  return { attr: m[1].toLowerCase(), value: m[2].toLowerCase() };
}

const router = Router();
router.use(scimAuth);
router.use((_req, res, next) => {
  res.type('application/scim+json');
  next();
});

// ── GET /Users ──
router.get('/Users', (req: Request, res: Response) => {
  const startIndex = Math.max(1, parseInt(req.query.startIndex as string) || 1);
  const count = Math.max(0, parseInt(req.query.count as string) || 100);
  const filter = parseFilter(req.query.filter as string | undefined);
  if (req.query.filter && !filter) {
    return scimError(res, 400, 'Only simple "<attr> eq \\"<value>\\"" filters are supported');
  }

  let filtered = people;
  if (filter) {
    filtered = people.filter((p) => {
      if (filter.attr === 'username') return p.email.toLowerCase() === filter.value;
      if (filter.attr === 'emails.value' || filter.attr === 'email') return p.email.toLowerCase() === filter.value;
      if (filter.attr === 'id') return p.id === filter.value;
      return false;
    });
  }

  const page = filtered.slice(startIndex - 1, startIndex - 1 + count);
  const base = baseUrlFor(req);
  res.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: filtered.length,
    startIndex,
    itemsPerPage: page.length,
    Resources: page.map((p) => toScimUser(p, base)),
  });
});

// ── GET /Users/:id ──
router.get('/Users/:id', (req: Request, res: Response) => {
  const p = people.find((x) => x.id === req.params.id);
  if (!p) return scimError(res, 404, `User ${req.params.id} not found`);
  res.json(toScimUser(p, baseUrlFor(req)));
});

// ── POST /Users (create) ──
router.post('/Users', (req: Request, res: Response) => {
  const body = req.body || {};
  const userName: string | undefined = body.userName;
  const email: string | undefined = body.emails?.[0]?.value || body.userName;
  if (!userName || !email) {
    return scimError(res, 400, 'userName and at least one email are required');
  }
  if (people.some((p) => p.email.toLowerCase() === email.toLowerCase())) {
    return scimError(res, 409, `User with email ${email} already exists`);
  }
  const now = new Date().toISOString();
  const name = body.name?.formatted
    || [body.name?.givenName, body.name?.familyName].filter(Boolean).join(' ')
    || body.displayName
    || userName;
  const person: StoredPerson = {
    id: uuid(),
    orgIds: [DEV_ORG_ID],
    accessibleOrgIds: [DEV_ORG_ID],
    name,
    email,
    role: 'VIEWER',
    title: '',
    skillIds: [],
    createdAt: now,
    updatedAt: now,
  };
  people.push(person);
  saveStore('people', people);
  auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_USER_CREATED', null, {
    personId: person.id, email: person.email,
  });
  logger.info({ personId: person.id, email: person.email }, 'SCIM created user');
  res.status(201).json(toScimUser(person, baseUrlFor(req)));
});

// ── PUT /Users/:id (replace) ──
router.put('/Users/:id', (req: Request, res: Response) => {
  const person = people.find((p) => p.id === req.params.id);
  if (!person) return scimError(res, 404, `User ${req.params.id} not found`);
  const body = req.body || {};
  if (body.userName) {
    const newEmail = body.userName.toLowerCase();
    if (newEmail !== person.email.toLowerCase() &&
      people.some((p) => p.id !== person.id && p.email.toLowerCase() === newEmail)) {
      return scimError(res, 409, `Email ${newEmail} is in use`);
    }
    person.email = body.userName;
  }
  if (body.emails?.[0]?.value) {
    person.email = body.emails[0].value;
  }
  if (body.name?.formatted) person.name = body.name.formatted;
  else if (body.name?.givenName || body.name?.familyName) {
    person.name = [body.name.givenName, body.name.familyName].filter(Boolean).join(' ');
  } else if (body.displayName) person.name = body.displayName;
  // active=false is the offboarding signal — most IdPs send PUT or
  // PATCH with active=false rather than DELETE so the SCIM record
  // sticks around for audit. Procela has no "inactive" flag yet, so
  // we delete the person on active=false. Loses audit trail of the
  // Person record itself — fine for now, follow-up to add a soft-
  // delete flag if customers demand it.
  if (body.active === false) {
    const idx = people.findIndex((p) => p.id === person.id);
    if (idx !== -1) {
      people.splice(idx, 1);
      saveStore('people', people);
      auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_USER_DEACTIVATED', null, {
        personId: person.id, email: person.email,
      });
      logger.info({ personId: person.id }, 'SCIM deactivated user (deleted)');
      return res.status(204).end();
    }
  }
  person.updatedAt = new Date().toISOString();
  saveStore('people', people);
  auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_USER_REPLACED', null, {
    personId: person.id, email: person.email,
  });
  res.json(toScimUser(person, baseUrlFor(req)));
});

// ── PATCH /Users/:id (partial update) ──
router.patch('/Users/:id', (req: Request, res: Response) => {
  const person = people.find((p) => p.id === req.params.id);
  if (!person) return scimError(res, 404, `User ${req.params.id} not found`);
  const body = req.body || {};
  if (!Array.isArray(body.Operations)) {
    return scimError(res, 400, 'PATCH body must include Operations[]');
  }
  if (body.schemas && !body.schemas.includes(SCIM_PATCH_SCHEMA)) {
    return scimError(res, 400, `PATCH body must use schema ${SCIM_PATCH_SCHEMA}`);
  }

  let deleted = false;
  for (const op of body.Operations) {
    const opType = String(op.op || '').toLowerCase();
    const path = String(op.path || '').toLowerCase();
    const value = op.value;

    if (opType === 'replace') {
      // Common case: { op: 'replace', value: { active: false } } —
      // value is an object of attribute updates with no path. Handle
      // both that shape and the explicit-path variant.
      const updates = path === '' && value && typeof value === 'object' ? value : { [path]: value };
      for (const [k, v] of Object.entries(updates)) {
        if (k === 'active') {
          if (v === false) deleted = true;
        } else if (k === 'username') {
          person.email = String(v);
        } else if (k === 'displayname' || k === 'name.formatted') {
          person.name = String(v);
        } else if (k === 'name.givenname' || k === 'name.familyname') {
          const parts = person.name.split(' ');
          if (k === 'name.givenname') person.name = [String(v), ...parts.slice(1)].join(' ');
          else person.name = [parts[0] || '', String(v)].join(' ').trim();
        }
        // Unknown attrs are quietly ignored — SCIM allows the server
        // to skip attributes it doesn't store. Logging would be noisy
        // for IdPs that send a full superset on every patch.
      }
    }
    // add / remove / move on multi-valued attributes are deliberately
    // not supported; falling back to ignore rather than rejecting so
    // IdPs that send a mix get the parts we DO support.
  }

  if (deleted) {
    const idx = people.findIndex((p) => p.id === person.id);
    if (idx !== -1) {
      people.splice(idx, 1);
      saveStore('people', people);
      auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_USER_DEACTIVATED', null, {
        personId: person.id, email: person.email,
      });
      return res.status(204).end();
    }
  }
  person.updatedAt = new Date().toISOString();
  saveStore('people', people);
  auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_USER_PATCHED', null, {
    personId: person.id, ops: body.Operations.length,
  });
  res.json(toScimUser(person, baseUrlFor(req)));
});

// ── DELETE /Users/:id ──
router.delete('/Users/:id', (req: Request, res: Response) => {
  const idx = people.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return scimError(res, 404, `User ${req.params.id} not found`);
  const person = people[idx];
  people.splice(idx, 1);
  saveStore('people', people);
  auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_USER_DELETED', null, {
    personId: person.id, email: person.email,
  });
  logger.info({ personId: person.id }, 'SCIM deleted user');
  res.status(204).end();
});

// ── GET /ServiceProviderConfig ──
router.get('/ServiceProviderConfig', (req: Request, res: Response) => {
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://datatracker.ietf.org/doc/html/rfc7644',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 1000 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Static bearer token configured via SCIM_BEARER_TOKEN',
        primary: true,
      },
    ],
    meta: {
      resourceType: 'ServiceProviderConfig',
      location: `${baseUrlFor(req)}/ServiceProviderConfig`,
    },
  });
});

// ── GET /ResourceTypes ──
router.get('/ResourceTypes', (req: Request, res: Response) => {
  const base = baseUrlFor(req);
  res.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 1,
    Resources: [
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        description: 'Procela person record',
        schema: SCIM_USER_SCHEMA,
        meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` },
      },
    ],
  });
});

// ── GET /Schemas ──
// Minimal — just enough to let an IdP probe that User is supported.
router.get('/Schemas', (_req: Request, res: Response) => {
  res.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 1,
    Resources: [
      {
        id: SCIM_USER_SCHEMA,
        name: 'User',
        description: 'SCIM 2.0 core User',
        attributes: [
          { name: 'userName', type: 'string', required: true, uniqueness: 'server' },
          { name: 'name', type: 'complex' },
          { name: 'emails', type: 'complex', multiValued: true, required: true },
          { name: 'displayName', type: 'string' },
          { name: 'active', type: 'boolean' },
        ],
      },
    ],
  });
});

// Groups: return empty list rather than 404 so probing IdPs don't
// throw a confusing error. Real group provisioning is out of scope.
router.get('/Groups', (_req: Request, res: Response) => {
  res.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 0,
    Resources: [],
  });
});

export default router;
