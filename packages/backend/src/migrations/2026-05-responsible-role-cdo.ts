// One-time migration that runs on backend startup. Fixes existing
// process nodes that the governance wand seeded with
// `responsibleRole: 'CDO'` — that string didn't match any option
// in the Responsible Role dropdown (the canonical label is
// 'Chief Data Officer'), so users saw a stray legacy value that
// couldn't be re-picked from the menu. The template now seeds the
// canonical label; this migration brings prior runs into line.
//
// Also runs a sanity check over the whole catalog that lists any
// other responsibleRole values that don't appear in the canonical
// label set, as a warning in the log. Doesn't auto-fix because we
// can't reliably know what a customer-entered free-text value
// meant — only the wand-seeded 'CDO' case is unambiguous.

import fs from 'fs';
import path from 'path';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';
import { processNodes } from '../routes/process-catalog';
import { saveStore } from '../lib/persistence';

const FLAG_DIR = path.resolve(process.cwd(), '.procela-data', 'migrations');
const FLAG_FILE = path.join(FLAG_DIR, '2026-05-responsible-role-cdo.done');

// Mirrors GOVERNANCE_ROLES + ROLE_OPTIONS from the frontend. Kept
// in sync by hand because the backend doesn't import from the
// frontend types module. Used only for the warn-on-drift sanity
// check at the end; the auto-fix only touches the literal 'CDO'.
const CANONICAL_GOVERNANCE_LABELS = new Set([
  'Chief Data Officer',
  'Data Governance Lead',
  'Data Owner',
  'Business Data Steward',
  'Technical Data Steward',
  'Data Quality Analyst',
  'Data Architect',
  'Data Custodian',
  'Data Engineer',
  'Database Administrator',
]);

export function runResponsibleRoleCdoMigration(): void {
  try {
    if (fs.existsSync(FLAG_FILE)) return;
    if (!fs.existsSync(FLAG_DIR)) fs.mkdirSync(FLAG_DIR, { recursive: true });

    let updated = 0;
    for (const node of processNodes) {
      if ((node as any).responsibleRole === 'CDO') {
        const before = { ...node };
        (node as any).responsibleRole = 'Chief Data Officer';
        (node as any).updatedAt = new Date().toISOString();
        auditService.log((node as any).orgId, null, 'ProcessNode', node.id, 'UPDATE', before, node);
        updated++;
      }
    }
    if (updated > 0) saveStore('processNodes', processNodes);

    // Sanity-check pass: surface any other free-text role values
    // that don't match the canonical labels, so a maintainer
    // notices template drift early. We don't auto-fix these.
    const unknown = new Map<string, number>();
    for (const node of processNodes) {
      const r = (node as any).responsibleRole;
      if (!r || typeof r !== 'string') continue;
      if (CANONICAL_GOVERNANCE_LABELS.has(r)) continue;
      // Operational free-text roles ("Domain Lead", "Plant Manager"
      // etc.) are expected; only flag values that look governance-
      // shaped (one of the role-type enum keys is a likely typo).
      if (/^(CDO|DATA_|BUSINESS_)/.test(r) || r === 'DBA') {
        unknown.set(r, (unknown.get(r) || 0) + 1);
      }
    }
    if (unknown.size > 0) {
      logger.warn(
        { drift: Object.fromEntries(unknown) },
        'Process catalog has responsibleRole values that look like role-type enum keys instead of canonical labels',
      );
    }

    fs.writeFileSync(FLAG_FILE, JSON.stringify({ ranAt: new Date().toISOString(), updated, unknownDrift: Object.fromEntries(unknown) }, null, 2));
    logger.info({ updated, drift: unknown.size }, 'Responsible-role CDO migration complete');
  } catch (err) {
    logger.error({ err }, 'Responsible-role CDO migration failed — will retry on next startup');
  }
}
