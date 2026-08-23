// First-run bootstrap. A clean production database has zero organizations and
// zero people — but creating a top-level org requires a SUPER_ADMIN, and the
// only other way to mint one was a manual DB insert or the insecure dev auth
// provider. This closes that day-zero seam: when BOOTSTRAP_SUPER_ADMIN_EMAIL is
// set, ensure the primary organization exists and that the named admin is a
// SUPER_ADMIN in it. Idempotent and safe to run on every boot.
//
// The primary org is created at the same id the API uses as its default tenant
// (primaryOrgId()), so the ~20 routes that fall back to that id now resolve to
// a real, named org instead of a phantom one, and federated users who default
// into it land somewhere real.

import { v4 as uuid } from 'uuid';
import config from '../config';
import logger from '../lib/logger';
import { primaryOrgId } from '../lib/provisioning';
import { organizations } from '../routes/organizations';
import { people } from '../routes/people';
import { getOrganizationsRepository } from '../db/organizations.repo';
import { getPeopleRepository } from '../db/people.repo';

export interface BootstrapOptions {
  superAdminEmail?: string;
  superAdminName?: string;
  orgName?: string;
  orgIndustry?: string;
  orgId?: string;
}

export interface BootstrapResult {
  skipped: boolean;
  orgId?: string;
  adminEmail?: string;
  createdOrg?: boolean;
  createdAdmin?: boolean;
  promotedAdmin?: boolean;
}

/**
 * Ensure the primary org + configured Super Admin exist. No-op unless a
 * Super Admin email is configured (via `opts` or BOOTSTRAP_SUPER_ADMIN_EMAIL).
 * Idempotent. Best-effort at boot: a failure is logged but never crashes the
 * server (the admin can retry by restarting once the DB is reachable). `opts`
 * exists so tests can drive it without mutating the frozen config.
 */
export async function runBootstrap(opts: BootstrapOptions = {}): Promise<BootstrapResult> {
  const email = (opts.superAdminEmail ?? config.bootstrapSuperAdminEmail).trim().toLowerCase();
  if (!email) return { skipped: true };

  const result: BootstrapResult = { skipped: false };
  try {
    const orgId = opts.orgId ?? primaryOrgId();
    const orgName = opts.orgName ?? config.bootstrapOrgName;
    const orgIndustry = opts.orgIndustry ?? config.bootstrapOrgIndustry;
    const adminName = opts.superAdminName ?? config.bootstrapSuperAdminName;
    result.orgId = orgId;
    result.adminEmail = email;
    const now = new Date().toISOString();
    const orgsRepo = getOrganizationsRepository(organizations);

    // 1) Ensure the primary organization exists.
    const existingOrg = await orgsRepo.get(orgId);
    if (!existingOrg) {
      await orgsRepo.create({
        id: orgId,
        parentId: null,
        name: orgName,
        type: 'company',
        industry: orgIndustry,
        description: '',
        headCount: 0,
        createdAt: now,
        updatedAt: now,
      } as never);
      result.createdOrg = true;
      logger.info({ orgId, name: orgName }, 'Bootstrap: created primary organization');
    }

    // 2) Ensure the Super Admin exists (and is actually SUPER_ADMIN).
    const peopleRepo = getPeopleRepository(people);
    const all = await peopleRepo.list();
    const existing = all.find((p) => p.email.toLowerCase() === email);

    if (!existing) {
      await peopleRepo.create({
        id: uuid(),
        orgIds: [orgId],
        accessibleOrgIds: [orgId],
        name: adminName,
        email,
        role: 'SUPER_ADMIN',
        title: '',
        skillIds: [],
        active: true,
        createdAt: now,
        updatedAt: now,
      } as never);
      result.createdAdmin = true;
      logger.info({ email }, 'Bootstrap: created SUPER_ADMIN — first federated login for this email will resolve as SUPER_ADMIN');
    } else if (existing.role !== 'SUPER_ADMIN') {
      // Idempotent promotion: guarantees the configured admin can always get
      // back in even if their role was changed.
      await peopleRepo.update(existing.id, { role: 'SUPER_ADMIN', updatedAt: now });
      result.promotedAdmin = true;
      logger.info({ email, id: existing.id }, 'Bootstrap: promoted configured admin to SUPER_ADMIN');
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Bootstrap failed — no Super Admin/org was created this boot');
  }
  return result;
}
