import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';
import { people, isActive, type StoredPerson } from './people';
import { saveStore } from '../lib/persistence';
import {
  scimGroups,
  findGroup,
  createGroup,
  replaceGroup,
  deleteGroup,
  addMembers,
  removeMembers,
  removeMemberFromAllGroups,
  type StoredScimGroup,
  type ScimGroupMember,
} from '../services/scim-groups';

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
const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
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
    active: isActive(p),
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

function toScimGroup(g: StoredScimGroup, baseUrl: string): Record<string, unknown> {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: g.id,
    displayName: g.displayName,
    ...(g.externalId ? { externalId: g.externalId } : {}),
    members: g.members.map((m) => ({
      value: m.value,
      display: m.display,
      type: m.type || 'User',
      $ref: `${baseUrl}/Users/${m.value}`,
    })),
    meta: {
      resourceType: 'Group',
      created: g.createdAt,
      lastModified: g.updatedAt,
      location: `${baseUrl}/Groups/${g.id}`,
    },
  };
}

// ── Filter parser ──
// SCIM 2.0 filter grammar (RFC 7644 §3.4.2.2) — a recursive-descent
// parser that handles the operators IdPs actually send:
//   eq pr co sw ew  on a single attribute
//   and or          to combine
//   ()              for grouping
// "ne" "gt" "ge" "lt" "le" are deliberately skipped — Procela's
// people model has no numeric or date fields that show up in SCIM
// queries, so they would silently always evaluate false and confuse
// callers. Reject explicitly instead.
//
// Returns a predicate that takes a StoredPerson; throws on syntax
// errors so the route can return 400. The whole filter is parsed up
// front so the per-person cost is just predicate evaluation.

type FilterPredicate = (p: StoredPerson) => boolean;

function attrValue(p: StoredPerson, attr: string): string | null {
  const a = attr.toLowerCase();
  if (a === 'username') return p.email;
  if (a === 'emails.value' || a === 'email') return p.email;
  if (a === 'id') return p.id;
  if (a === 'displayname' || a === 'name.formatted') return p.name;
  if (a === 'name.givenname') return (p.name || '').split(' ')[0] || '';
  if (a === 'name.familyname') return (p.name || '').split(' ').slice(1).join(' ');
  if (a === 'active') return String(isActive(p));
  return null;
}

interface FilterToken {
  type: 'word' | 'string' | 'lparen' | 'rparen';
  value: string;
}

function tokenize(input: string): FilterToken[] {
  const tokens: FilterToken[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (c === '(') { tokens.push({ type: 'lparen', value: '(' }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'rparen', value: ')' }); i++; continue; }
    if (c === '"') {
      let end = i + 1;
      while (end < input.length && input[end] !== '"') end++;
      if (end >= input.length) throw new Error('Unterminated string in filter');
      tokens.push({ type: 'string', value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    // Word: identifier (attr, operator, true/false). Stops at whitespace
    // or paren or quote.
    let end = i;
    while (end < input.length && !/[\s()"]/.test(input[end])) end++;
    tokens.push({ type: 'word', value: input.slice(i, end) });
    i = end;
  }
  return tokens;
}

function parseFilterExpr(input: string): FilterPredicate {
  const tokens = tokenize(input);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];
  const eatWord = (expect?: string): string => {
    const t = eat();
    if (!t || t.type !== 'word') throw new Error(`Expected word, got ${t?.value ?? 'EOF'}`);
    if (expect && t.value.toLowerCase() !== expect.toLowerCase()) {
      throw new Error(`Expected "${expect}", got "${t.value}"`);
    }
    return t.value;
  };

  // Grammar: orExpr → andExpr (OR andExpr)*
  //          andExpr → unary (AND unary)*
  //          unary → atom
  //          atom → ( orExpr ) | comparison
  //          comparison → attr op [value]
  const parseAtom = (): FilterPredicate => {
    const t = peek();
    if (!t) throw new Error('Unexpected end of filter');
    if (t.type === 'lparen') {
      eat();
      const inner = parseOr();
      const close = eat();
      if (!close || close.type !== 'rparen') throw new Error('Missing closing paren');
      return inner;
    }
    if (t.type !== 'word') throw new Error(`Unexpected token "${t.value}"`);
    const attr = eatWord();
    const op = eatWord().toLowerCase();
    if (op === 'pr') {
      return (p) => {
        const v = attrValue(p, attr);
        return v !== null && v !== '' && v !== undefined;
      };
    }
    const valTok = eat();
    if (!valTok || (valTok.type !== 'string' && valTok.type !== 'word')) {
      throw new Error(`Expected value after "${op}"`);
    }
    const val = valTok.value;
    switch (op) {
      case 'eq': return (p) => (attrValue(p, attr) ?? '').toLowerCase() === val.toLowerCase();
      case 'co': return (p) => (attrValue(p, attr) ?? '').toLowerCase().includes(val.toLowerCase());
      case 'sw': return (p) => (attrValue(p, attr) ?? '').toLowerCase().startsWith(val.toLowerCase());
      case 'ew': return (p) => (attrValue(p, attr) ?? '').toLowerCase().endsWith(val.toLowerCase());
      default: throw new Error(`Unsupported operator "${op}"`);
    }
  };
  const parseAnd = (): FilterPredicate => {
    let left = parseAtom();
    while (peek() && peek().type === 'word' && peek().value.toLowerCase() === 'and') {
      eat();
      const right = parseAtom();
      const l = left; left = (p) => l(p) && right(p);
    }
    return left;
  };
  const parseOr = (): FilterPredicate => {
    let left = parseAnd();
    while (peek() && peek().type === 'word' && peek().value.toLowerCase() === 'or') {
      eat();
      const right = parseAnd();
      const l = left; left = (p) => l(p) || right(p);
    }
    return left;
  };

  const result = parseOr();
  if (pos < tokens.length) throw new Error(`Unexpected trailing tokens at "${tokens[pos]?.value}"`);
  return result;
}

// ── Multi-valued PATCH selector ──
// SCIM PATCH paths can target a slot inside a multi-valued attribute,
// e.g. `emails[type eq "work"].value` to set the work email. Procela
// only stores one email per person, so we accept any selector that
// resolves to the email slot and replace it. Returns true when the
// path was a recognized multi-valued selector (caller skips the
// standard scalar handling), false otherwise.
function applyEmailSelectorPath(person: StoredPerson, path: string, value: unknown): boolean {
  // Common shapes Entra / Okta emit:
  //   emails[type eq "work"].value
  //   emails[primary eq true].value
  //   emails.value
  if (!/^emails(\[.+\])?\.value$/i.test(path)) return false;
  if (typeof value !== 'string' || !value) return true; // accepted but no-op
  person.email = value;
  return true;
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
  const filterStr = req.query.filter as string | undefined;

  let predicate: FilterPredicate | null = null;
  if (filterStr) {
    try {
      predicate = parseFilterExpr(filterStr);
    } catch (err: any) {
      return scimError(res, 400, `Invalid filter: ${err?.message || 'parse error'}`);
    }
  }

  // SCIM responses include deactivated users by default — the IdP
  // is the one driving the active flag and wants to see its own
  // record back. Local API consumers should still filter on the
  // active flag when displaying lists to humans.
  const filtered = predicate ? people.filter(predicate) : people;

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
  // active=false is the standard offboarding signal — IdPs send PUT
  // or PATCH rather than DELETE so the record sticks around for
  // audit. We flip the active flag and stash a deactivatedAt
  // timestamp; the record is preserved (still owns its authored
  // comments, role-assignment history, audit references) but the
  // person can no longer sign in and drops out of default list
  // views. SCIM PUTs that flip active=true reactivate.
  if (body.active === false && isActive(person)) {
    person.active = false;
    person.deactivatedAt = new Date().toISOString();
    auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_USER_DEACTIVATED', null, {
      personId: person.id, email: person.email,
    });
    logger.info({ personId: person.id }, 'SCIM deactivated user');
  } else if (body.active === true && !isActive(person)) {
    person.active = true;
    person.deactivatedAt = undefined;
    auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_USER_REACTIVATED', null, {
      personId: person.id, email: person.email,
    });
    logger.info({ personId: person.id }, 'SCIM reactivated user');
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

  let activeChange: boolean | null = null;
  for (const op of body.Operations) {
    const opType = String(op.op || '').toLowerCase();
    const rawPath = String(op.path || '');
    const path = rawPath.toLowerCase();
    const value = op.value;

    if (opType === 'replace' || opType === 'add') {
      // Two shapes:
      //   1) { op: 'replace', value: { active: false, … } } — no
      //      path; value is an object of attribute updates.
      //   2) { op: 'replace', path: 'active', value: false } — path
      //      names the attribute.
      //   3) { op: 'replace', path: 'emails[type eq "work"].value',
      //                       value: 'new@example.com' } — multi-
      //      valued attribute with a value-selector. Supported for
      //      the primary email since that's how Okta sends email
      //      changes.
      const updates = path === '' && value && typeof value === 'object'
        ? value
        : { [path]: value };
      for (const [k, v] of Object.entries(updates)) {
        if (applyEmailSelectorPath(person, k, v)) continue;
        if (k === 'active') {
          if (v === false || v === true) activeChange = v as boolean;
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
    } else if (opType === 'remove') {
      // Common remove: { op: 'remove', path: 'emails[type eq "work"]' }
      // We don't model removing the primary email (it IS the
      // identity), so quietly ignore. Removing a value from a
      // single-value attribute clears it.
      if (path === 'displayname' || path === 'name.formatted') {
        // No-op: name is required for our model.
      }
    }
  }

  if (activeChange === false && isActive(person)) {
    person.active = false;
    person.deactivatedAt = new Date().toISOString();
    auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_USER_DEACTIVATED', null, {
      personId: person.id, email: person.email,
    });
  } else if (activeChange === true && !isActive(person)) {
    person.active = true;
    person.deactivatedAt = undefined;
    auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_USER_REACTIVATED', null, {
      personId: person.id, email: person.email,
    });
  }
  person.updatedAt = new Date().toISOString();
  saveStore('people', people);
  auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_USER_PATCHED', null, {
    personId: person.id, ops: body.Operations.length,
  });
  res.json(toScimUser(person, baseUrlFor(req)));
});

// ── DELETE /Users/:id ──
// Hard delete (vs. active=false which is soft-delete). Removes the
// person from every SCIM group they're in so we don't leave dangling
// member refs that would 404 on next group read.
router.delete('/Users/:id', (req: Request, res: Response) => {
  const idx = people.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return scimError(res, 404, `User ${req.params.id} not found`);
  const person = people[idx];
  people.splice(idx, 1);
  saveStore('people', people);
  removeMemberFromAllGroups(person.id);
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
    totalResults: 2,
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
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'Group',
        name: 'Group',
        endpoint: '/Groups',
        description: 'SCIM-facing flat membership group',
        schema: SCIM_GROUP_SCHEMA,
        meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/Group` },
      },
    ],
  });
});

// ── GET /Schemas ──
// Minimal — just enough to let an IdP probe that User + Group are supported.
router.get('/Schemas', (_req: Request, res: Response) => {
  res.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 2,
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
      {
        id: SCIM_GROUP_SCHEMA,
        name: 'Group',
        description: 'SCIM 2.0 core Group (flat membership)',
        attributes: [
          { name: 'displayName', type: 'string', required: true },
          { name: 'members', type: 'complex', multiValued: true },
        ],
      },
    ],
  });
});

// ── Groups ──
// SCIM Groups are a flat membership directory (id + displayName +
// members[]). They are intentionally separate from Procela's
// governance-groups model — SCIM groups represent "what the IdP
// thinks the directory looks like", governance-groups represent the
// formal data-governance program. An admin can wire a mapping later
// if they want SCIM group membership to drive role / org assignment.

router.get('/Groups', (req: Request, res: Response) => {
  const startIndex = Math.max(1, parseInt(req.query.startIndex as string) || 1);
  const count = Math.max(0, parseInt(req.query.count as string) || 100);
  const filterStr = req.query.filter as string | undefined;

  // Simple group filtering: only displayName eq supported. The full
  // user-filter parser is overkill for groups (they have ~3 queryable
  // attrs) so we cherry-pick the common case.
  let filtered = scimGroups;
  if (filterStr) {
    const m = filterStr.match(/^\s*displayName\s+eq\s+"([^"]+)"\s*$/i);
    if (!m) return scimError(res, 400, 'Only "displayName eq \\"<name>\\"" is supported for group filters');
    const target = m[1].toLowerCase();
    filtered = scimGroups.filter((g) => g.displayName.toLowerCase() === target);
  }

  const page = filtered.slice(startIndex - 1, startIndex - 1 + count);
  const base = baseUrlFor(req);
  res.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: filtered.length,
    startIndex,
    itemsPerPage: page.length,
    Resources: page.map((g) => toScimGroup(g, base)),
  });
});

router.get('/Groups/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const group = findGroup(id);
  if (!group) return scimError(res, 404, `Group ${id} not found`);
  res.json(toScimGroup(group, baseUrlFor(req)));
});

router.post('/Groups', (req: Request, res: Response) => {
  const body = req.body || {};
  if (!body.displayName) return scimError(res, 400, 'displayName is required');
  const members: ScimGroupMember[] = Array.isArray(body.members)
    ? body.members.map((m: any) => ({
        value: String(m.value),
        display: m.display ? String(m.display) : undefined,
        type: m.type === 'Group' ? 'Group' : 'User',
      }))
    : [];
  const group = createGroup({
    displayName: String(body.displayName),
    externalId: body.externalId ? String(body.externalId) : undefined,
    members,
  });
  auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_GROUP_CREATED', null, {
    groupId: group.id, displayName: group.displayName, members: group.members.length,
  });
  res.status(201).json(toScimGroup(group, baseUrlFor(req)));
});

router.put('/Groups/:id', (req: Request, res: Response) => {
  const body = req.body || {};
  const members: ScimGroupMember[] | undefined = Array.isArray(body.members)
    ? body.members.map((m: any) => ({
        value: String(m.value),
        display: m.display ? String(m.display) : undefined,
        type: m.type === 'Group' ? 'Group' : 'User',
      }))
    : undefined;
  const id = String(req.params.id);
  const group = replaceGroup(id, {
    displayName: body.displayName,
    externalId: body.externalId,
    members,
  });
  if (!group) return scimError(res, 404, `Group ${id} not found`);
  auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_GROUP_REPLACED', null, {
    groupId: group.id, displayName: group.displayName,
  });
  res.json(toScimGroup(group, baseUrlFor(req)));
});

router.patch('/Groups/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const group = findGroup(id);
  if (!group) return scimError(res, 404, `Group ${id} not found`);
  const body = req.body || {};
  if (!Array.isArray(body.Operations)) return scimError(res, 400, 'PATCH body must include Operations[]');

  for (const op of body.Operations) {
    const opType = String(op.op || '').toLowerCase();
    const path = String(op.path || '');
    const value = op.value;

    if (opType === 'replace' && (path === 'displayName' || path.toLowerCase() === 'displayname')) {
      replaceGroup(group.id, { displayName: String(value) });
    } else if (opType === 'add' && path === 'members') {
      const toAdd: ScimGroupMember[] = Array.isArray(value)
        ? value.map((m: any) => ({
            value: String(m.value),
            display: m.display ? String(m.display) : undefined,
            type: m.type === 'Group' ? 'Group' : 'User',
          }))
        : [];
      addMembers(group.id, toAdd);
    } else if (opType === 'remove' && path.startsWith('members')) {
      // Two shapes IdPs send for member removal:
      //   1) { op: 'remove', path: 'members[value eq "abc"]' }     single
      //   2) { op: 'remove', path: 'members', value: [{value:'abc'}] } batch
      const m = path.match(/members\[\s*value\s+eq\s+"([^"]+)"\s*\]/i);
      if (m) {
        removeMembers(group.id, [m[1]]);
      } else if (Array.isArray(value)) {
        removeMembers(group.id, value.map((v: any) => String(v.value)));
      } else if (path === 'members' && value === undefined) {
        // "remove all members" — rare but allowed.
        replaceGroup(group.id, { members: [] });
      }
    }
    // Other op/path combos are ignored — Procela's group model is
    // intentionally thin (no description, no nested attrs), so any
    // attribute the IdP wants to track beyond name + members is
    // dropped on the floor here. SCIM allows it.
  }
  const updated = findGroup(group.id)!;
  auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_GROUP_PATCHED', null, {
    groupId: group.id, ops: body.Operations.length, memberCount: updated.members.length,
  });
  res.json(toScimGroup(updated, baseUrlFor(req)));
});

router.delete('/Groups/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const ok = deleteGroup(id);
  if (!ok) return scimError(res, 404, `Group ${id} not found`);
  auditService.log(DEV_ORG_ID, null, 'Auth', 'scim', 'SCIM_GROUP_DELETED', null, { groupId: id });
  res.status(204).end();
});

export default router;
