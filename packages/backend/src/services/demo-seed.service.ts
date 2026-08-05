// One-click demo seed. Populates a Tidewater Utilities fixture in one
// call so a live demo doesn't start with 10 minutes of CSV imports.
//
// Deliberately compact: seeds the shape the demo tells a story about
// (org tree + people + systems + agents + domains + assets +
// mappings + process hierarchy + Susan Chen persona + planted
// orphans) — not every last row a full production catalogue would
// have. The training walkthrough still exists for anyone who wants
// to type the whole thing in manually.
//
// Idempotent: every row is stamped with a `demo-` prefixed id, and
// the reseed pass clears anything with that prefix from every
// registered store first. Safe to run repeatedly.

import { organizations } from '../routes/organizations';
import { people } from '../routes/people';
import { systems } from '../routes/systems';
import { agents } from '../routes/agents';
import { dataDomains } from '../routes/data-domains';
import { dataAssets } from '../routes/data-assets';
import { processNodes, flowRelationships } from '../routes/process-catalog';
import { mappings } from '../routes/mappings';
import { governanceTasks } from '../routes/governance-tasks';
import { governanceIssues } from '../routes/governance-issues';
import { dataQualityRules } from '../routes/data-quality';
import { connectors, connectorEvents } from '../routes/connectors';
import { calendarEvents } from '../routes/governance-calendar';
import { aiTemplateCache } from '../routes/ai';
import { saveStore } from '../lib/persistence';
import logger from '../lib/logger';

const P = 'demo-'; // shared prefix — sweep target on reseed

function now() { return new Date().toISOString(); }
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

function sweep(): void {
  const stores: Array<[any[], string]> = [
    [organizations, 'organizations'],
    [people, 'people'],
    [systems, 'systems'],
    [agents, 'agents'],
    [dataDomains, 'dataDomains'],
    [dataAssets, 'dataAssets'],
    [processNodes, 'processNodes'],
    [flowRelationships, 'flowRelationships'],
    [mappings, 'mappings'],
    [governanceTasks, 'governanceTasks'],
    [governanceIssues, 'governanceIssues'],
    [dataQualityRules, 'dataQualityRules'],
    [connectors, 'connectors'],
    [connectorEvents, 'connectorEvents'],
    [calendarEvents, 'calendarEvents'],
  ];
  for (const [arr, storeName] of stores) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i]?.id?.startsWith(P)) arr.splice(i, 1);
    }
    saveStore(storeName, arr);
  }
  // AI template cache is keyed by industry string, not `id`. Sweep
  // demo-owned keys separately so a reseed refreshes the pre-warmed
  // Electric + Water entries.
  const demoCacheKeys = new Set([
    'utilities|tidewater electric',
    'utilities|tidewater water',
  ]);
  for (let i = aiTemplateCache.length - 1; i >= 0; i--) {
    if (demoCacheKeys.has(aiTemplateCache[i]?.industry)) aiTemplateCache.splice(i, 1);
  }
  saveStore('aiTemplateCache', aiTemplateCache);
}

export interface DemoSeedReport {
  organizations: number;
  people: number;
  systems: number;
  agents: number;
  dataDomains: number;
  dataAssets: number;
  processNodes: number;
  mappings: number;
  governanceTasks: number;
  governanceIssues: number;
  dataQualityRules: number;
  connectors: number;
  connectorEvents: number;
  calendarEvents: number;
  persona: { id: string; name: string };
}

/**
 * Wipe any existing `demo-*` rows and seed a Tidewater Utilities
 * demo fixture. Returns per-store row counts and identifies the
 * demo persona (Susan Chen) so the caller can offer a "sign in as
 * Susan" action next.
 */
export function seedDemoData(): DemoSeedReport {
  sweep();
  const ts = now();

  // ── Organizations ──
  const orgTidewater = { id: P + 'org-tidewater', parentId: null, name: 'Tidewater Utilities', type: 'company', industry: 'Utilities', description: 'Multi-utility demo tenant — electric + water + shared services.', headCount: 0, tenantSlug: 'tidewater', brandDisplayName: 'Tidewater Utilities', brandGlyph: '⚡', ssoButtonLabel: 'Sign in with Tidewater SSO', brandPrimaryColor: '#0f4f46', createdAt: ts, updatedAt: ts };
  const orgElectric = { id: P + 'org-electric', parentId: orgTidewater.id, name: 'Tidewater Electric', type: 'division', industry: 'Utilities', description: 'Electric division', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgWater = { id: P + 'org-water', parentId: orgTidewater.id, name: 'Tidewater Water', type: 'division', industry: 'Utilities', description: 'Water division', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgShared = { id: P + 'org-shared', parentId: orgTidewater.id, name: 'Shared Services', type: 'division', industry: 'Utilities', description: 'IT / Finance / HR / Regulatory / Safety', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgIT = { id: P + 'org-it', parentId: orgShared.id, name: 'Information Technology', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgRegulatory = { id: P + 'org-regulatory', parentId: orgShared.id, name: 'Regulatory Affairs', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgTd = { id: P + 'org-td', parentId: orgElectric.id, name: 'Transmission & Distribution', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgCustomerElectric = { id: P + 'org-electric-customer', parentId: orgElectric.id, name: 'Electric Customer Service', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  // Water division mirrors Electric's shape: an operations department
  // (parallel to T&D) and a customer-service department, both nested
  // under the water division so the tree isn't lopsided.
  const orgWaterOps = { id: P + 'org-water-ops', parentId: orgWater.id, name: 'Water Operations', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgWaterCustomer = { id: P + 'org-water-customer', parentId: orgWater.id, name: 'Water Customer Service', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  organizations.push(orgTidewater, orgElectric, orgWater, orgShared, orgIT, orgRegulatory, orgTd, orgCustomerElectric, orgWaterOps, orgWaterCustomer);
  saveStore('organizations', organizations);

  // ── People (compact — enough to tell the demo story) ──
  // Susan Chen is the demo persona: signed-in user for the demo. Owns
  // Customer Data, holds three open tasks + one issue, has an
  // upcoming event.
  const susan = { id: P + 'person-susan-chen', orgIds: [orgTidewater.id], accessibleOrgIds: [orgTidewater.id, orgElectric.id, orgWater.id, orgShared.id, orgWaterOps.id, orgWaterCustomer.id], name: 'Susan Chen', email: 'susan.chen@tidewater-utilities.com', role: 'ORG_ADMIN', title: 'Chief Data Officer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const marisol = { id: P + 'person-marisol', orgIds: [orgTidewater.id], accessibleOrgIds: [orgTidewater.id], name: 'Marisol Hadid', email: 'marisol.hadid@tidewater-utilities.com', role: 'ORG_ADMIN', title: 'Data Governance Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const devon = { id: P + 'person-devon', orgIds: [orgElectric.id], accessibleOrgIds: [orgElectric.id], name: 'Devon Kershaw', email: 'devon.kershaw@tidewater-utilities.com', role: 'ORG_ADMIN', title: 'Data Owner Tidewater Electric', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const jennifer = { id: P + 'person-jennifer', orgIds: [orgTd.id], accessibleOrgIds: [orgTd.id, orgElectric.id], name: 'Jennifer Vasquez', email: 'jennifer.vasquez@tidewater-utilities.com', role: 'EDITOR', title: 'Director Transmission & Distribution Ops', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const brandon = { id: P + 'person-brandon', orgIds: [orgTd.id], accessibleOrgIds: [orgTd.id], name: 'Brandon Willis', email: 'brandon.willis@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Data Steward Grid Operations', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const melissa = { id: P + 'person-melissa', orgIds: [orgTd.id], accessibleOrgIds: [orgTd.id], name: 'Melissa Patel', email: 'melissa.patel@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'System Operator Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const harold = { id: P + 'person-harold', orgIds: [orgTd.id], accessibleOrgIds: [orgTd.id], name: 'Harold Lindstrom', email: 'harold.lindstrom@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Distribution Control Center', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const natalie = { id: P + 'person-natalie', orgIds: [orgCustomerElectric.id], accessibleOrgIds: [orgCustomerElectric.id], name: 'Natalie Greer', email: 'natalie.greer@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Data Steward Customer Data', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const andre = { id: P + 'person-andre', orgIds: [orgCustomerElectric.id], accessibleOrgIds: [orgCustomerElectric.id], name: 'Andre Ferguson', email: 'andre.ferguson@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Billing & Revenue', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const kwame = { id: P + 'person-kwame', orgIds: [orgIT.id], accessibleOrgIds: [orgIT.id], name: 'Kwame Osei', email: 'kwame.osei@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Lead Data Engineer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const amara = { id: P + 'person-amara', orgIds: [orgIT.id], accessibleOrgIds: [orgIT.id], name: 'Amara Wambui', email: 'amara.wambui@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Data & Analytics', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const tobias = { id: P + 'person-tobias', orgIds: [orgIT.id], accessibleOrgIds: [orgIT.id], name: 'Tobias Reinholt', email: 'tobias.reinholt@tidewater-utilities.com', role: 'EDITOR', title: 'Manager OT Cybersecurity', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const lorraine = { id: P + 'person-lorraine', orgIds: [orgRegulatory.id], accessibleOrgIds: [orgRegulatory.id], name: 'Lorraine Kimura', email: 'lorraine.kimura@tidewater-utilities.com', role: 'EDITOR', title: 'Director Regulatory Affairs', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const phillip = { id: P + 'person-phillip', orgIds: [orgRegulatory.id], accessibleOrgIds: [orgRegulatory.id], name: 'Phillip Rosenberg', email: 'phillip.rosenberg@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Data Steward Compliance Evidence', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const samira = { id: P + 'person-samira', orgIds: [orgCustomerElectric.id], accessibleOrgIds: [orgCustomerElectric.id], name: 'Samira Farooq', email: 'samira.farooq@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Contact Center', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const isabella = { id: P + 'person-isabella', orgIds: [orgRegulatory.id], accessibleOrgIds: [orgRegulatory.id], name: 'Isabella Rossi', email: 'isabella.rossi@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Water Compliance', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  // Referenced by the training guide (Module 4.1 override-owner example
  // + Module 4.3 domain steward table). Kept separate from the water
  // block because Deborah is on the electric generation side.
  const deborah = { id: P + 'person-deborah', orgIds: [orgTd.id], accessibleOrgIds: [orgTd.id, orgElectric.id], name: 'Deborah Kwon', email: 'deborah.kwon@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Data Steward Generation', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  // Water division staff — mirrors the Electric footprint (division-
  // level Data Owner, an Ops director and two operators, plus a
  // customer-side steward + billing manager).
  const nadia = { id: P + 'person-nadia', orgIds: [orgWater.id], accessibleOrgIds: [orgWater.id], name: 'Nadia Petrov', email: 'nadia.petrov@tidewater-utilities.com', role: 'ORG_ADMIN', title: 'Data Owner Tidewater Water', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const marcus = { id: P + 'person-marcus', orgIds: [orgWaterOps.id], accessibleOrgIds: [orgWaterOps.id, orgWater.id], name: 'Marcus Chen', email: 'marcus.chen@tidewater-utilities.com', role: 'EDITOR', title: 'Director Water Operations', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const sophie = { id: P + 'person-sophie', orgIds: [orgWaterOps.id], accessibleOrgIds: [orgWaterOps.id], name: 'Sophie Larsson', email: 'sophie.larsson@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Data Steward Water Operations', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const rafael = { id: P + 'person-rafael', orgIds: [orgWaterOps.id], accessibleOrgIds: [orgWaterOps.id], name: 'Rafael Ortiz', email: 'rafael.ortiz@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'System Operator Lead — Water Treatment', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const priya = { id: P + 'person-priya', orgIds: [orgWaterOps.id], accessibleOrgIds: [orgWaterOps.id], name: 'Priya Sharma', email: 'priya.sharma@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Water Distribution Control', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const kaia = { id: P + 'person-kaia', orgIds: [orgWaterCustomer.id], accessibleOrgIds: [orgWaterCustomer.id], name: 'Kaia Nakamura', email: 'kaia.nakamura@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Data Steward Water Customer Data', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const diego = { id: P + 'person-diego', orgIds: [orgWaterCustomer.id], accessibleOrgIds: [orgWaterCustomer.id], name: 'Diego Alvarez', email: 'diego.alvarez@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Water Billing', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  people.push(susan, marisol, devon, jennifer, brandon, melissa, harold, natalie, andre, kwame, amara, tobias, lorraine, phillip, samira, isabella, deborah, nadia, marcus, sophie, rafael, priya, kaia, diego);
  saveStore('people', people);

  // ── Systems ──
  const sysSCADA = { id: P + 'sys-scada', orgId: orgElectric.id, name: 'SCADA', description: 'Supervisory Control And Data Acquisition — real-time grid telemetry.', systemType: 'OT', vendorName: 'GE', ownerPersonId: tobias.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  const sysCIS = { id: P + 'sys-cis', orgId: orgTidewater.id, name: 'CIS', description: 'Customer Information System — accounts, addresses, service history.', systemType: 'IT', vendorName: 'Oracle', ownerPersonId: andre.id, stewardIds: [natalie.id], createdAt: ts, updatedAt: ts };
  const sysAMI = { id: P + 'sys-ami', orgId: orgTidewater.id, name: 'AMI', description: 'Advanced Metering Infrastructure — interval reads from smart meters.', systemType: 'OT', vendorName: 'Itron', ownerPersonId: kwame.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  const sysOMS = { id: P + 'sys-oms', orgId: orgElectric.id, name: 'OMS', description: 'Outage Management System — event tracking, restoration workflows.', systemType: 'OT', vendorName: 'ABB', ownerPersonId: harold.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  const sysGIS = { id: P + 'sys-gis', orgId: orgTidewater.id, name: 'GIS', description: 'Geospatial Information System — assets in the field.', systemType: 'IT', vendorName: 'Esri', ownerPersonId: jennifer.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  const sysWarehouse = { id: P + 'sys-warehouse', orgId: orgTidewater.id, name: 'Data Warehouse', description: 'Enterprise analytics warehouse (Snowflake).', systemType: 'IT', vendorName: 'Snowflake', ownerPersonId: kwame.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  // Water-specific systems (parallel to electric's SCADA + OMS).
  const sysLIMS = { id: P + 'sys-lims', orgId: orgWater.id, name: 'LIMS', description: 'Laboratory Information Management System — water quality tests, sample chain of custody, effluent monitoring.', systemType: 'IT', vendorName: 'LabWare', ownerPersonId: sophie.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysHydraulic = { id: P + 'sys-hydraulic', orgId: orgWater.id, name: 'Hydraulic Model', description: 'Distribution network hydraulic simulation — pressure, flow, main-break impact analysis.', systemType: 'OT', vendorName: 'Bentley OpenFlows', ownerPersonId: priya.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  systems.push(sysSCADA, sysCIS, sysAMI, sysOMS, sysGIS, sysWarehouse, sysLIMS, sysHydraulic);
  saveStore('systems', systems);

  // ── Agents (5 — one of each type, all wired to responsible persons) ──
  agents.push(
    { id: P + 'agent-outage-model', orgIds: [orgElectric.id], name: 'Outage Prediction Model', agentType: 'AI', description: 'Predicts distribution outage probability from weather and asset health.', provider: 'Internal ML Platform', status: 'ACTIVE', ownerPersonId: amara.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: P + 'agent-ami-pipeline', orgIds: [orgTidewater.id], name: 'AMI Meter Ingestion Pipeline', agentType: 'PIPELINE', description: 'Hourly ETL for electric and water meter interval data into the data lake.', provider: 'Apache Airflow', status: 'ACTIVE', ownerPersonId: kwame.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: P + 'agent-notify-bot', orgIds: [orgTidewater.id], name: 'Customer Notification Bot', agentType: 'BOT', description: 'Automated SMS and voice outage notifications and restoration updates.', provider: 'Twilio', status: 'ACTIVE', ownerPersonId: samira.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: P + 'agent-pi-service', orgIds: [orgElectric.id], name: 'PI Historian Service Account', agentType: 'SERVICE_ACCOUNT', description: 'Read-only account used by analytics jobs to extract historian tags.', provider: 'OSIsoft', status: 'ACTIVE', ownerPersonId: tobias.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: P + 'agent-compliance', orgIds: [orgTidewater.id], name: 'Compliance Report Generator', agentType: 'OTHER', description: 'Scheduled generator producing NPDES DMR and DWR monthly submissions.', provider: 'Internal', status: 'ACTIVE', ownerPersonId: isabella.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
  );
  saveStore('agents', agents);

  // ── Data Domains ──
  const domCustomer = { id: P + 'domain-customer', orgId: orgTidewater.id, name: 'Customer Data', description: 'Customer accounts, addresses, service history, billing.', ownerId: susan.id, stewardIds: [natalie.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domOps = { id: P + 'domain-ops', orgId: orgTidewater.id, name: 'Operational Data', description: 'Grid, generation, metering — the real-time and near-real-time operational feeds.', ownerId: jennifer.id, stewardIds: [brandon.id, deborah.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domRegulatory = { id: P + 'domain-regulatory', orgId: orgTidewater.id, name: 'Regulatory Data', description: 'Compliance evidence, filings, rate case data, NERC CIP + EPA SDWA.', ownerId: lorraine.id, stewardIds: [phillip.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  dataDomains.push(domCustomer, domOps, domRegulatory);

  // ── Data Assets (with domain inheritance where the pattern applies) ──
  const assetOutageLogs = { id: P + 'asset-outage-logs', orgId: orgElectric.id, name: 'Outage Logs', description: 'Per-event SCADA records of distribution outages.', systemId: sysSCADA.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 62, createdAt: ts, updatedAt: ts };
  const assetCustomerMaster = { id: P + 'asset-customer-master', orgId: orgTidewater.id, name: 'Customer Master', description: 'Service addresses, account status, billing terms.', systemId: sysCIS.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 88, sensitivityTags: ['PII' as const], createdAt: ts, updatedAt: ts };
  const assetMeterReads = { id: P + 'asset-meter-reads', orgId: orgTidewater.id, name: 'Meter Reads', description: 'AMI 15-minute interval consumption.', systemId: sysAMI.id, owner: '', ownerPersonId: andre.id, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 91, createdAt: ts, updatedAt: ts };
  const assetGeneration = { id: P + 'asset-generation-output', orgId: orgElectric.id, name: 'Generation Output', description: 'Plant-level MWh by hour.', systemId: sysSCADA.id, owner: '', ownerPersonId: deborah.id, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 55, createdAt: ts, updatedAt: ts };
  // Planted orphans — obviously-named so Ask AI's "which data assets
  // have no process using them?" produces a quotable answer.
  const orphanLegacyBilling = { id: P + 'asset-legacy-billing', orgId: orgTidewater.id, name: 'Legacy Billing Extract', description: 'Nightly dump from the retired billing system. Kept as a fallback but no process references it.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  const orphanMeterCsv = { id: P + 'asset-meter-csv', orgId: orgTidewater.id, name: 'Meter CSV Dump', description: 'Ad-hoc CSV extract of yesterday\'s meter reads for an old vendor. Nobody remembers if it\'s still used.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  // Water-side assets (parallel to Outage Logs / Generation Output on
  // the electric side). Distribution Pressure feeds the Main Break
  // Response process below; Water Quality Results are LIMS-sourced;
  // NPDES Discharge is the compliance evidence asset.
  const assetDistPressure = { id: P + 'asset-dist-pressure', orgId: orgWater.id, name: 'Distribution Pressure Reads', description: 'Continuous pressure telemetry from PRV stations and district metered areas.', systemId: sysSCADA.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 84, createdAt: ts, updatedAt: ts };
  const assetWaterQuality = { id: P + 'asset-water-quality', orgId: orgWater.id, name: 'Water Quality Results', description: 'Lab and in-line water quality samples — turbidity, chlorine residual, coliform, pH.', systemId: sysLIMS.id, owner: '', ownerPersonId: sophie.id, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 79, createdAt: ts, updatedAt: ts };
  const assetNPDES = { id: P + 'asset-npdes', orgId: orgWater.id, name: 'NPDES Discharge Records', description: 'Wastewater effluent discharge monitoring reports for state and EPA submissions.', systemId: sysLIMS.id, owner: '', ownerPersonId: isabella.id, stewardIds: [phillip.id] as string[], governanceTier: 'GOLD' as const, healthScore: 92, createdAt: ts, updatedAt: ts };
  dataAssets.push(assetOutageLogs, assetCustomerMaster, assetMeterReads, assetGeneration, orphanLegacyBilling, orphanMeterCsv, assetDistPressure, assetWaterQuality, assetNPDES);
  saveStore('dataAssets', dataAssets);

  // Wire the domain → asset backrefs so the Domains page shows counts.
  domCustomer.dataAssetIds = [assetCustomerMaster.id];
  domOps.dataAssetIds = [assetOutageLogs.id, assetMeterReads.id, assetGeneration.id, assetDistPressure.id, assetWaterQuality.id];
  domRegulatory.dataAssetIds = [assetNPDES.id];
  saveStore('dataDomains', dataDomains);

  // ── Process hierarchy (Tidewater Electric) ──
  // Compact but meaningful: one value stream, two processes, one
  // sub-process per process, three activities. Enough to demo
  // Dependencies, BCM attributes, and mappings.
  const vs = { id: P + 'node-vs-outage', parentId: null, level: 'VALUE_STREAM' as const, name: 'Outage Management', description: 'End-to-end restoration flow — detect, dispatch, communicate, recover.', activityId: 'VS-DEMO-1', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procDetect = { id: P + 'node-proc-detect', parentId: vs.id, level: 'PROCESS' as const, name: 'Detect & Assess', description: 'Detect outages via SCADA + customer channel, triage severity.', activityId: 'PRO-DEMO-1', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procRestore = { id: P + 'node-proc-restore', parentId: vs.id, level: 'PROCESS' as const, name: 'Restore & Communicate', description: 'Dispatch crews, restore service, notify customers.', activityId: 'PRO-DEMO-2', status: 'ACTIVE', orderIndex: 1, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: samira.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spTriage = { id: P + 'node-sp-triage', parentId: procDetect.id, level: 'SUBPROCESS' as const, name: 'Outage Triage', description: 'Sort outages by criticality, allocate crews.', activityId: 'SP-DEMO-1', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  // actSignal sits upstream of actTriage so the Dependencies panel on
  // the seeded Outage triage shows a real predecessor — matches
  // playbook beat 3's promise.
  const actSignal = { id: P + 'node-act-signal', parentId: spTriage.id, level: 'ACTIVITY' as const, name: 'SCADA anomaly detected', description: 'Grid telemetry flags a probable outage — voltage sag, breaker open, or historian gap.', activityId: 'ACT-DEMO-0', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, responsibleRole: 'System Operator Lead', responsiblePersonId: melissa.id, systemIds: [sysSCADA.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actTriage = { id: P + 'node-act-triage', parentId: spTriage.id, level: 'ACTIVITY' as const, name: 'Outage triage', description: 'Classify incoming outages, dispatch first responders.', activityId: 'ACT-DEMO-1', status: 'ACTIVE', orderIndex: 1, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, responsibleRole: 'System Operator Lead', responsiblePersonId: melissa.id, systemIds: [sysSCADA.id, sysOMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Field crew on site within 30 minutes for Tier 1 outages', slaTarget: 'P95 30 min from detection', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actDispatch = { id: P + 'node-act-dispatch', parentId: procRestore.id, level: 'ACTIVITY' as const, name: 'Crew dispatch', description: 'Assign crews to outages by location + skill.', activityId: 'ACT-DEMO-2', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, responsibleRole: 'Line Superintendent', systemIds: [sysGIS.id, sysOMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actNotify = { id: P + 'node-act-notify', parentId: procRestore.id, level: 'ACTIVITY' as const, name: 'Customer notification sent', description: 'SMS/email/voice notifications to affected customers.', activityId: 'ACT-DEMO-3', status: 'ACTIVE', orderIndex: 1, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: samira.id, responsibleRole: 'Manager Contact Center', responsiblePersonId: samira.id, systemIds: [sysCIS.id], requiredSkillIds: [] as string[], version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  processNodes.push(vs, procDetect, procRestore, spTriage, actSignal, actTriage, actDispatch, actNotify);

  // Flow relationships wiring the Electric activity chain. Feeds the
  // Dependencies panel: Outage triage sees actSignal as predecessor
  // and actDispatch as successor; actDispatch fans into actNotify.
  flowRelationships.push(
    { id: P + 'flow-1', fromNodeId: actSignal.id, toNodeId: actTriage.id, type: 'SEQUENCE' as const, label: 'anomaly confirmed', createdAt: ts },
    { id: P + 'flow-2', fromNodeId: actTriage.id, toNodeId: actDispatch.id, type: 'SEQUENCE' as const, label: 'crew required', createdAt: ts },
    { id: P + 'flow-3', fromNodeId: actDispatch.id, toNodeId: actNotify.id, type: 'SEQUENCE' as const, label: 'ETA available', createdAt: ts },
  );

  // ── Process hierarchy (Tidewater Water) ──
  // Mirrors the Electric shape: one value stream, two processes, one
  // sub-process, three activities. Priority pair with Outage Management
  // — Main Break Response is the equivalent restoration flow, plus a
  // Treatment process for the quality-testing story.
  const vsW = { id: P + 'node-vs-water', parentId: null, level: 'VALUE_STREAM' as const, name: 'Water Distribution & Quality', description: 'End-to-end delivery of safe potable water — treat, distribute, monitor, restore.', activityId: 'VS-DEMO-W1', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: marcus.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procMainBreak = { id: P + 'node-proc-main-break', parentId: vsW.id, level: 'PROCESS' as const, name: 'Main Break Response', description: 'Detect and repair distribution main breaks before customer complaints escalate.', activityId: 'PRO-DEMO-W1', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: priya.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procTreatment = { id: P + 'node-proc-treatment', parentId: vsW.id, level: 'PROCESS' as const, name: 'Treatment Operations', description: 'Run treatment plants + monitor water quality against permit thresholds.', activityId: 'PRO-DEMO-W2', status: 'ACTIVE' as const, orderIndex: 1, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: rafael.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spBreakTriage = { id: P + 'node-sp-break-triage', parentId: procMainBreak.id, level: 'SUBPROCESS' as const, name: 'Break Triage', description: 'Confirm break, size the affected zone, dispatch the right crew.', activityId: 'SP-DEMO-W1', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: priya.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actDetectBreak = { id: P + 'node-act-detect-break', parentId: spBreakTriage.id, level: 'ACTIVITY' as const, name: 'Detect main break', description: 'Acoustic sensors + pressure anomalies flag likely breaks.', activityId: 'ACT-DEMO-W1', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: priya.id, responsibleRole: 'System Operator Lead — Water Treatment', responsiblePersonId: rafael.id, systemIds: [sysSCADA.id, sysHydraulic.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Break confirmed within 15 minutes of anomaly signal', slaTarget: 'P95 15 min from anomaly to dispatch', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actDispatchWater = { id: P + 'node-act-dispatch-water', parentId: procMainBreak.id, level: 'ACTIVITY' as const, name: 'Dispatch repair crew', description: 'Match crew skill + equipment to the break location and severity.', activityId: 'ACT-DEMO-W2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: priya.id, responsibleRole: 'Manager Water Distribution Control', systemIds: [sysGIS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actWaterQualityTest = { id: P + 'node-act-quality-test', parentId: procTreatment.id, level: 'ACTIVITY' as const, name: 'Water quality sample test', description: 'Draw + analyse the shift sample; log turbidity, chlorine residual, coliform.', activityId: 'ACT-DEMO-W3', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: rafael.id, responsibleRole: 'Data Steward Water Operations', responsiblePersonId: sophie.id, systemIds: [sysLIMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 2, successMeasure: 'Every shift sample logged within 4 hours', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  processNodes.push(vsW, procMainBreak, procTreatment, spBreakTriage, actDetectBreak, actDispatchWater, actWaterQualityTest);
  saveStore('processNodes', processNodes);

  // Water-side flow — Detect main break → Dispatch repair crew.
  // Mirrors the electric predecessor/successor story.
  flowRelationships.push(
    { id: P + 'flow-w1', fromNodeId: actDetectBreak.id, toNodeId: actDispatchWater.id, type: 'SEQUENCE' as const, label: 'break confirmed', createdAt: ts },
  );
  saveStore('flowRelationships', flowRelationships);

  // ── Mappings ──
  mappings.push(
    { id: P + 'map-1', orgId: orgElectric.id, processStepId: actTriage.id, dataAssetId: assetOutageLogs.id, linkType: 'INPUT', notes: 'Consumes raw outage records', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: P + 'map-2', orgId: orgElectric.id, processStepId: actTriage.id, dataAssetId: assetCustomerMaster.id, linkType: 'INPUT', notes: 'Cross-references affected customers', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: P + 'map-3', orgId: orgElectric.id, processStepId: actNotify.id, dataAssetId: assetCustomerMaster.id, linkType: 'INPUT', notes: 'Pulls customer contact preferences', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: P + 'map-4', orgId: orgTidewater.id, processStepId: actDispatch.id, dataAssetId: assetMeterReads.id, linkType: 'INPUT', notes: 'Verifies restoration via meter reads', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    // Water side mappings — parallel shape to electric's three.
    { id: P + 'map-w1', orgId: orgWater.id, processStepId: actDetectBreak.id, dataAssetId: assetDistPressure.id, linkType: 'INPUT', notes: 'Reads pressure telemetry to confirm the break signal', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: P + 'map-w2', orgId: orgWater.id, processStepId: actDetectBreak.id, dataAssetId: assetCustomerMaster.id, linkType: 'INPUT', notes: 'Identifies the customers in the affected zone', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: P + 'map-w3', orgId: orgWater.id, processStepId: actWaterQualityTest.id, dataAssetId: assetWaterQuality.id, linkType: 'OUTPUT', notes: 'Writes the shift sample result set', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
  );
  saveStore('mappings', mappings);

  // ── Governance tasks assigned to Susan (populates My Dashboard) ──
  governanceTasks.push(
    { id: P + 'task-1', orgId: orgTidewater.id, title: 'Approve Q3 data classification review', description: 'Review the AI-suggested sensitivity tags on Customer Master and Outage Logs and approve or reject each.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'HIGH' as any, assigneeId: susan.id, dueDate: daysFromNow(3), linkedObjectType: 'DataAsset', linkedObjectId: assetCustomerMaster.id, automationMode: 'HUMAN' as any, createdBy: marisol.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: P + 'task-2', orgId: orgTidewater.id, title: 'Sign off on Regulatory Data domain scope', description: 'Lorraine has proposed expanding the Regulatory Data domain to cover new SDWA reporting fields.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'MEDIUM' as any, assigneeId: susan.id, dueDate: daysFromNow(7), linkedObjectType: 'DataDomain', linkedObjectId: domRegulatory.id, automationMode: 'HUMAN' as any, createdBy: lorraine.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: P + 'task-3', orgId: orgTidewater.id, title: 'Retire Legacy Billing Extract or find its owner', description: 'This asset has been sitting orphaned for two quarters. Confirm it can go, or reassign it.', taskType: 'GENERAL' as any, status: 'OPEN' as any, priority: 'LOW' as any, assigneeId: susan.id, dueDate: daysFromNow(14), linkedObjectType: 'DataAsset', linkedObjectId: orphanLegacyBilling.id, automationMode: 'HUMAN' as any, createdBy: null, createdAt: ts, updatedAt: ts, completedAt: null },
  );
  saveStore('governanceTasks', governanceTasks);

  // ── One open governance issue assigned to Susan ──
  governanceIssues.push({
    id: P + 'issue-1',
    orgId: orgTidewater.id,
    title: 'Generation Output tier below Silver — critical process, ungoverned',
    description: 'Generation Output is BRONZE tier but the Detect & Assess process depends on it as an input. Recommend promoting to Silver with an SLA target.',
    issueType: 'OWNERSHIP' as any,
    severity: 'HIGH' as any,
    status: 'OPEN' as any,
    domainId: domOps.id,
    dataAssetId: assetGeneration.id,
    systemId: sysSCADA.id,
    reportedBy: marisol.id,
    assignedTo: susan.id,
    resolutionSummary: null,
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
  } as any);
  saveStore('governanceIssues', governanceIssues);

  // ── Data Quality rules ──
  // Two rules that tell a demo story:
  //   * Customer Master · Completeness · currently PASSING at 96 —
  //     the healthy state. Demonstrates the green DQ tile on the
  //     Dashboard and the rule detail on the DQ page.
  //   * Generation Output · Timeliness · currently FAILING at 62 —
  //     under threshold. Same asset as the seeded governance issue,
  //     so the DQ tile and the issue tell one coherent story.
  const dqPassing = {
    id: P + 'dq-rule-passing',
    orgId: orgTidewater.id,
    dataAssetId: assetCustomerMaster.id,
    dimension: 'COMPLETENESS' as const,
    name: 'Customer Master · email completeness',
    description: 'At least 95% of customer records must have a non-null email address.',
    threshold: 95,
    currentScore: 96,
    weight: 1,
    status: 'PASSING' as const,
    lastMeasured: ts,
    scheduleFrequency: 'DAILY' as const,
    nextRunAt: daysFromNow(1),
    createdAt: ts,
    updatedAt: ts,
  };
  const dqFailing = {
    id: P + 'dq-rule-failing',
    orgId: orgElectric.id,
    dataAssetId: assetGeneration.id,
    dimension: 'TIMELINESS' as const,
    name: 'Generation Output · hourly write latency',
    description: 'Every hour the plant should write within 5 minutes of the reporting boundary. Rolling 24h.',
    threshold: 95,
    currentScore: 62,
    weight: 1,
    status: 'FAILING' as const,
    lastMeasured: ts,
    scheduleFrequency: 'HOURLY' as const,
    nextRunAt: daysFromNow(0),
    createdAt: ts,
    updatedAt: ts,
  };
  dataQualityRules.push(dqPassing, dqFailing);
  saveStore('dataQualityRules', dataQualityRules);

  // ── Edge connector (on-prem agent) ──
  // One healthy connector shows the customer their in-network agent
  // relationship in the demo without needing to spin up a real
  // container on stage. Pair state is populated; the token hash is
  // a fixed sha256 of the string "demo-connector-token" so a demo
  // reader can grep the store and see how the field looks without
  // exposing a plaintext token. Freshness bucket is computed live
  // at read time — we set lastHeartbeatAt to 45 seconds ago so the
  // row shows ONLINE without any timing acrobatics.
  const connectorHeartbeatAt = new Date(Date.now() - 45 * 1000).toISOString();
  const connectorCreatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const connectorSyncAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const conn = {
    id: P + 'conn-tidewater',
    orgId: orgTidewater.id,
    name: 'Tidewater Data Platform Connector',
    // sha256("demo-connector-token") — the plaintext isn't reachable
    // through the demo path so this is illustrative only, but keeps
    // the schema honest.
    tokenHash: '5f6d3c4f26f9c50a9c1a5a2f70c3f7f4a0b3d3c8b3f7d9c3a1e2f5b6c9d0e1f2',
    pairingCode: null,
    pairingCodeExpiresAt: null,
    systemIds: [sysAMI.id, sysWarehouse.id],
    lastHeartbeatAt: connectorHeartbeatAt,
    agentVersion: '1.2.0',
    status: 'ONLINE' as const,
    createdAt: connectorCreatedAt,
    updatedAt: connectorHeartbeatAt,
  };
  connectors.push(conn);
  saveStore('connectors', connectors);

  // Wire the connector's most recent sync onto Meter Reads so the
  // Data Asset detail page shows the "Synced 5 min ago" chip during
  // the demo. Cast through any because the field lives on the asset
  // as a runtime extension that the connector route adds without a
  // schema change — the frontend picks it up unconditionally.
  (assetMeterReads as any).lastSyncedByConnectorId = conn.id;
  (assetMeterReads as any).lastSyncedAt = connectorSyncAt;
  saveStore('dataAssets', dataAssets);

  // Connector activity feed — the "Events" tab on the connector
  // detail. Order is chronological ascending; the UI reverses on
  // render so newest reads first.
  connectorEvents.push(
    {
      id: P + 'ce-paired', connectorId: conn.id, orgId: orgTidewater.id,
      type: 'PAIRED', ts: connectorCreatedAt,
      data: { agentVersion: '1.2.0' },
    },
    {
      id: P + 'ce-scan-start', connectorId: conn.id, orgId: orgTidewater.id,
      type: 'SCAN_STARTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      data: { targetSystemIds: [sysAMI.id, sysWarehouse.id] },
    },
    {
      id: P + 'ce-scan-done', connectorId: conn.id, orgId: orgTidewater.id,
      type: 'SCAN_COMPLETED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 40 * 1000).toISOString(),
      data: { durationMs: 40_120, assetsDiscovered: 1 },
    },
    {
      id: P + 'ce-assets', connectorId: conn.id, orgId: orgTidewater.id,
      type: 'ASSETS_REPORTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 45 * 1000).toISOString(),
      data: { incoming: 1, created: 0, updated: 1 },
    },
    {
      id: P + 'ce-hb', connectorId: conn.id, orgId: orgTidewater.id,
      type: 'HEARTBEAT', ts: connectorHeartbeatAt,
      data: { agentVersion: '1.2.0' },
    },
  );
  saveStore('connectorEvents', connectorEvents);

  // Second connector — PAIRING state. Shows the other half of the
  // agent lifecycle so the demo can walk both "just installed,
  // waiting to be claimed" and "steady-state ONLINE". Pairing code
  // is a fixed 8-digit string; expiry ~5 minutes into the future
  // so a live claim from the CLI during the demo would actually
  // work if the presenter wanted to prove the round-trip.
  const pairingConn = {
    id: P + 'conn-pairing',
    orgId: orgTidewater.id,
    name: 'Water Plant SCADA Connector',
    tokenHash: null,
    pairingCode: '19427301',
    pairingCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    systemIds: [] as string[],
    lastHeartbeatAt: null,
    agentVersion: null,
    status: 'PAIRED' as const,
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  };
  connectors.push(pairingConn as any);
  saveStore('connectors', connectors);

  // ── Governance calendar event ──
  // Populates the fourth My Dashboard tile (Upcoming Events) so
  // the persona doesn't have three lit tiles and one blank.
  // Weekly Data Governance Committee sync — the archetypal DAMA
  // artefact, Susan owns it, meets Fridays at 09:00.
  const dayNow = new Date();
  const daysUntilFriday = (5 - dayNow.getDay() + 7) % 7 || 7;
  const nextFriday = new Date(dayNow.getFullYear(), dayNow.getMonth(), dayNow.getDate() + daysUntilFriday, 9, 0, 0);
  calendarEvents.push({
    id: P + 'cal-dgc',
    orgId: orgTidewater.id,
    name: 'Data Governance Committee weekly',
    description: 'Weekly cross-domain review — open issues, escalations, control decisions, upcoming policy work.',
    eventType: 'COMMITTEE_MEETING' as const,
    cadence: 'WEEKLY' as const,
    dayOfMonth: null,
    dayOfWeek: 5,
    timeOfDay: '09:00',
    durationMinutes: 60,
    attendees: [susan.id, marisol.id, devon.id, lorraine.id],
    agendaTemplate: '1. Open governance issues (from bell)\n2. Domain scope changes\n3. Control effectiveness review\n4. Upcoming policy publications',
    nextOccurrence: nextFriday.toISOString(),
    lastOccurrence: null,
    autoCreateTasks: false,
    status: 'ACTIVE' as const,
    createdAt: ts,
    updatedAt: ts,
  });
  saveStore('calendarEvents', calendarEvents);

  // ── AI template cache — pre-warm the wand for Tidewater ──
  // A live demo can't afford the 10–30s Claude wait on the "Generate
  // processes" wand. Seeding two hand-crafted templates against the
  // real cache keys means the first click for Electric OR Water
  // returns instantly. The user can still hit "Regenerate from AI"
  // if they want a fresh live call — the button bypasses the cache.
  aiTemplateCache.push(
    {
      industry: 'utilities|tidewater electric',
      industryLabel: 'Utilities — Tidewater Electric',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Outage Management',
            description: 'Detect, dispatch, restore, and communicate through distribution outages.',
            purpose: 'Restore electric service safely and quickly when the grid is disrupted.',
            businessOutcome: 'Reliable power delivery and defensible SAIDI / SAIFI performance to the regulator.',
            processes: [
              { name: 'Detect & Assess', description: 'Identify the outage and its scope from SCADA and customer channels.', purpose: 'Turn raw signals into an actionable event.', activities: [
                { name: 'Detect outage from SCADA', description: 'SCADA breaker + FCI events land in the OMS.' },
                { name: 'Correlate customer reports', description: 'Cross-reference contact-centre calls with the outage extent.' },
                { name: 'Classify severity', description: 'Assign a Tier 1/2/3 based on customer count and critical loads.' },
              ] },
              { name: 'Dispatch & Restore', description: 'Assign crews, execute switching, restore service.', purpose: 'Get the lights back on with the safest possible plan.', activities: [
                { name: 'Assign crew', description: 'Match the closest qualified crew to the outage in GIS.' },
                { name: 'Execute switching plan', description: 'Isolate the fault and back-feed unaffected customers.' },
                { name: 'Confirm restoration', description: 'Verify restoration via meter reads and customer callback.' },
              ] },
              { name: 'Communicate & Report', description: 'Keep customers and regulators informed throughout the event.', purpose: 'Meet notification SLAs and regulatory reporting deadlines.', activities: [
                { name: 'Notify affected customers', description: 'SMS, voice, and email based on customer contact preferences.' },
                { name: 'Update outage map', description: 'Publish restoration ETAs on the public outage map.' },
                { name: 'File regulatory report', description: 'Submit reliability event data to the PUC.' },
              ] },
            ],
          },
          {
            name: 'Generation Operations',
            description: 'Run the generation fleet to meet load and reliability targets.',
            purpose: 'Deliver dispatchable capacity into the wholesale + retail markets.',
            businessOutcome: 'Margin on generation vs market prices while staying inside environmental limits.',
            processes: [
              { name: 'Day-Ahead Planning', description: 'Forecast load, commit units, and file day-ahead bids.', purpose: 'Line up the least-cost generation stack for tomorrow.', activities: [
                { name: 'Forecast day-ahead load', description: 'Combine weather + historical patterns into an hourly forecast.' },
                { name: 'Commit units', description: 'Schedule unit start-ups given fuel and ramp constraints.' },
              ] },
              { name: 'Real-Time Operations', description: 'Balance generation against load in real time.', purpose: 'Keep the lights on and frequency stable across the interconnect.', activities: [
                { name: 'Monitor plant output', description: 'Watch MW output vs schedule per unit.' },
                { name: 'Dispatch adjustments', description: 'Move generation up or down to hold ACE within limits.' },
              ] },
            ],
          },
          {
            name: 'Customer Operations',
            description: 'Onboard, bill, and serve residential + commercial electric customers.',
            purpose: 'Deliver a defensible customer experience across the meter-to-cash lifecycle.',
            businessOutcome: 'Cash collected on time; low arrears; high CSAT.',
            processes: [
              { name: 'New Service Onboarding', description: 'Set up a new customer at a new address.', purpose: 'Get the meter energised, billed, and pointed at the right rate.', activities: [
                { name: 'Receive new service request', description: 'From the web portal or contact centre.' },
                { name: 'Provision meter', description: 'Schedule field visit + install the AMI meter.' },
                { name: 'Activate billing account', description: 'Create the CIS account and enrol in the correct rate.' },
              ] },
              { name: 'Meter-to-Cash', description: 'Read meters, bill customers, collect payment.', purpose: 'Convert consumption into revenue.', activities: [
                { name: 'Ingest interval reads', description: 'AMI reads flow into the billing engine hourly.' },
                { name: 'Generate bill', description: 'Apply the customer rate schedule to their consumption.' },
                { name: 'Receive payment', description: 'Post payment to the CIS account.' },
              ] },
            ],
          },
        ],
      },
    },
    {
      industry: 'utilities|tidewater water',
      industryLabel: 'Utilities — Tidewater Water',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Water Treatment',
            description: 'Convert raw source water into potable water that meets SDWA standards.',
            purpose: 'Produce safe drinking water at the volumes customers demand.',
            businessOutcome: 'Zero SDWA violations, minimum chemical cost, defensible turbidity trend.',
            processes: [
              { name: 'Coagulation & Sedimentation', description: 'Add coagulant + settle solids.', purpose: 'Remove suspended particles before filtration.', activities: [
                { name: 'Dose coagulant', description: 'Adjust dose based on raw water turbidity + temperature.' },
                { name: 'Settle sludge', description: 'Sediment settles into the sludge collection zone.' },
              ] },
              { name: 'Filtration & Disinfection', description: 'Filter + chlorinate.', purpose: 'Meet the primary drinking water standards.', activities: [
                { name: 'Run filter cycle', description: 'Media filters catch remaining solids; backwash on turbidity breakthrough.' },
                { name: 'Chlorinate', description: 'Dose chlorine to hit residual + CT targets.' },
              ] },
            ],
          },
          {
            name: 'Water Distribution',
            description: 'Move potable water from plants to customer taps under pressure.',
            purpose: 'Deliver enough water at the right pressure to every service line.',
            businessOutcome: 'Low non-revenue water; low main-break rate; predictable pressure at all zones.',
            processes: [
              { name: 'Pressure Management', description: 'Keep distribution pressure inside a safe operating band.', purpose: 'Balance customer service against pipe stress.', activities: [
                { name: 'Monitor DMA pressure', description: 'Read PRV telemetry across the district metered areas.' },
                { name: 'Adjust PRV setpoints', description: 'Tune valve setpoints in response to demand patterns.' },
              ] },
              { name: 'Main Break Response', description: 'Detect + repair main breaks.', purpose: 'Restore service before customer complaints escalate.', activities: [
                { name: 'Detect main break', description: 'Acoustic sensors + pressure anomalies flag likely breaks.' },
                { name: 'Dispatch repair crew', description: 'Match crew to break location.' },
                { name: 'Restore service', description: 'Repair the main and re-pressurise the affected zone.' },
              ] },
            ],
          },
          {
            name: 'Wastewater Operations',
            description: 'Collect and treat wastewater to NPDES permit standards.',
            purpose: 'Return safe effluent to the receiving water body.',
            businessOutcome: 'Zero NPDES exceedances; steady biosolids production.',
            processes: [
              { name: 'Collection', description: 'Convey wastewater from customers to the treatment plant.', purpose: 'Keep the collection system flowing.', activities: [
                { name: 'Monitor pump stations', description: 'Watch wet-well levels + pump run-hours.' },
                { name: 'Respond to blockages', description: 'Vac truck dispatch for grease + root intrusion events.' },
              ] },
              { name: 'Treatment', description: 'Biological + chemical treatment of collected wastewater.', purpose: 'Meet effluent permit limits.', activities: [
                { name: 'Run activated sludge process', description: 'Aerate + return sludge to hit BOD/TSS targets.' },
                { name: 'Disinfect effluent', description: 'UV or chlorine disinfection before discharge.' },
              ] },
            ],
          },
        ],
      },
    },
  );
  saveStore('aiTemplateCache', aiTemplateCache);

  logger.info({ persona: susan.name }, 'Demo data seeded');

  return {
    organizations: 10,
    people: 24,
    systems: 8,
    agents: 5,
    dataDomains: 3,
    dataAssets: 9,
    processNodes: 15,
    mappings: 7,
    governanceTasks: 3,
    governanceIssues: 1,
    dataQualityRules: 2,
    connectors: 2,
    connectorEvents: 5,
    calendarEvents: 1,
    persona: { id: susan.id, name: susan.name },
  };
}
