// One-time migration that runs on backend startup. Cleans up the
// 15 governance "Data Assets" that the old process-catalog
// governance template seeded — most of those rows were really
// governance documents (Charter, Standards, Policies) or were
// duplicates of entities that have their own home in Procela
// (Glossary, Domains, Lineage, DQ Rules, Issues, Tasks).
//
// What it does, per Data Asset with origin === 'GOVERNANCE_TEMPLATE':
//
//   * Pure documents → create an equivalent StoredGovernancePolicy
//     with the right documentType (Charter / Standard / Policy /
//     Framework) and the same orgId / description / owner /
//     steward. Delete the original asset.
//   * Names that duplicate an existing first-class entity (the
//     Glossary, Data Domain Catalog, Data Lineage Maps, Quality
//     Rule Definitions, Data Issue Log, Change Request Records) →
//     delete. The dedicated entity is already there; the template
//     was creating a parallel placeholder.
//   * Report / output rows (Quality Scores & Reports, Access
//     Compliance Reports, Data Classification Register, Stakeholder
//     Communications) → delete. They were never stored data —
//     they're rendered from other entities.
//   * Anything else (user-customized, unrecognised) → leave alone.
//
// Every conversion writes an audit log row. The migration is
// gated by a flag file (.procela-data/migrations/2026-05-govdocs.done)
// so it runs exactly once per environment. Safe to run multiple
// times if the flag file is deleted — name-matching is exact
// and "POLICY" rows from a previous run are now in
// governancePolicies, not in dataAssets, so they won't match.

import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';
import { governancePolicies, type StoredGovernancePolicy } from '../routes/governance-policies';
import { dataAssets } from '../routes/data-assets';
import { saveStore } from '../lib/persistence';

const FLAG_DIR = path.resolve(process.cwd(), '.procela-data', 'migrations');
const FLAG_FILE = path.join(FLAG_DIR, '2026-05-govdocs.done');

// Pure documents — convert to governance policies with the right
// type. Name match is exact (the template wrote these specific
// strings); if a user renamed the row we leave it alone.
const DOCUMENT_CONVERSIONS: Array<{ name: string; documentType: StoredGovernancePolicy['documentType']; category: StoredGovernancePolicy['category'] }> = [
  { name: 'Data Governance Charter', documentType: 'CHARTER',  category: 'GOVERNANCE' },
  { name: 'Data Policies',           documentType: 'POLICY',   category: 'GENERAL' },
  { name: 'Data Standards',          documentType: 'STANDARD', category: 'GOVERNANCE' },
  { name: 'Access Control Policies', documentType: 'POLICY',   category: 'ACCESS' },
];

// Duplicates of first-class entities → just delete the placeholder
// asset. The Glossary, Domains, Lineage etc. pages are the home.
const DUPLICATE_ENTITY_NAMES = new Set([
  'Business Glossary',
  'Data Domain Catalog',
  'Data Lineage Maps',
  'Quality Rule Definitions',
  'Data Issue Log',
  'Change Request Records',
]);

// Outputs / reports that aren't stored entities anywhere — they're
// rendered from other surfaces, so the asset row was always
// misleading.
const OUTPUT_NAMES = new Set([
  'Quality Scores & Reports',
  'Access Compliance Reports',
  'Data Classification Register',
  'Stakeholder Communications',
  'Root Cause Analysis Records',
]);

export function runGovernanceDocsMigration(): void {
  try {
    if (fs.existsSync(FLAG_FILE)) return;
    if (!fs.existsSync(FLAG_DIR)) fs.mkdirSync(FLAG_DIR, { recursive: true });

    const stats = { converted: 0, duplicatesDeleted: 0, outputsDeleted: 0, skipped: 0 };

    // Walk dataAssets backwards so splice() doesn't shift indices
    // out from under us.
    for (let i = dataAssets.length - 1; i >= 0; i--) {
      const asset: any = dataAssets[i];
      if (asset.origin !== 'GOVERNANCE_TEMPLATE') continue;

      const conversion = DOCUMENT_CONVERSIONS.find((c) => c.name === asset.name);
      if (conversion) {
        const now = new Date().toISOString();
        const codeSeq = governancePolicies.filter((p) => p.documentType === conversion.documentType).length + 1;
        const codePrefix = { CHARTER: 'CHA', FRAMEWORK: 'FRW', STANDARD: 'STD', POLICY: 'POL' }[conversion.documentType];
        const policy: StoredGovernancePolicy = {
          id: uuid(),
          orgId: asset.orgId,
          code: `${codePrefix}-${String(codeSeq).padStart(3, '0')}`,
          name: asset.name,
          description: asset.description || '',
          documentType: conversion.documentType,
          status: 'DRAFT',
          ownerAssignmentId: asset.ownerPersonId || null,
          category: conversion.category,
          reviewFrequency: 'ANNUAL',
          lastReviewDate: null,
          nextReviewDate: null,
          effectiveDate: null,
          content: '',
          createdAt: asset.createdAt || now,
          updatedAt: now,
        };
        governancePolicies.push(policy);
        auditService.log(policy.orgId, null, 'GovernancePolicy', policy.id, 'CREATE', null, policy);
        auditService.log(asset.orgId, null, 'DataAsset', asset.id, 'DELETE', asset, null);
        dataAssets.splice(i, 1);
        stats.converted++;
        continue;
      }

      if (DUPLICATE_ENTITY_NAMES.has(asset.name)) {
        auditService.log(asset.orgId, null, 'DataAsset', asset.id, 'DELETE', asset, null);
        dataAssets.splice(i, 1);
        stats.duplicatesDeleted++;
        continue;
      }

      if (OUTPUT_NAMES.has(asset.name)) {
        auditService.log(asset.orgId, null, 'DataAsset', asset.id, 'DELETE', asset, null);
        dataAssets.splice(i, 1);
        stats.outputsDeleted++;
        continue;
      }

      stats.skipped++;
    }

    saveStore('governancePolicies', governancePolicies);
    saveStore('dataAssets', dataAssets);
    fs.writeFileSync(FLAG_FILE, JSON.stringify({ ranAt: new Date().toISOString(), stats }, null, 2));
    logger.info(stats, 'Governance-docs migration complete: converted documents to Policies, deleted entity duplicates and output rows.');
  } catch (err) {
    logger.error({ err }, 'Governance-docs migration failed — will retry on next startup');
  }
}
