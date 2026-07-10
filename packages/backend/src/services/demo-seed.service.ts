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
import { processNodes } from '../routes/process-catalog';
import { mappings } from '../routes/mappings';
import { governanceTasks } from '../routes/governance-tasks';
import { governanceIssues } from '../routes/governance-issues';
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
    [mappings, 'mappings'],
    [governanceTasks, 'governanceTasks'],
    [governanceIssues, 'governanceIssues'],
  ];
  for (const [arr, storeName] of stores) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i]?.id?.startsWith(P)) arr.splice(i, 1);
    }
    saveStore(storeName, arr);
  }
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
  organizations.push(orgTidewater, orgElectric, orgWater, orgShared, orgIT, orgRegulatory, orgTd, orgCustomerElectric);
  saveStore('organizations', organizations);

  // ── People (compact — enough to tell the demo story) ──
  // Susan Chen is the demo persona: signed-in user for the demo. Owns
  // Customer Data, holds three open tasks + one issue, has an
  // upcoming event.
  const susan = { id: P + 'person-susan-chen', orgIds: [orgTidewater.id], accessibleOrgIds: [orgTidewater.id, orgElectric.id, orgWater.id, orgShared.id], name: 'Susan Chen', email: 'susan.chen@tidewater-utilities.com', role: 'ORG_ADMIN', title: 'Chief Data Officer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
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
  people.push(susan, marisol, devon, jennifer, brandon, melissa, harold, natalie, andre, kwame, amara, tobias, lorraine, phillip, samira, isabella);
  saveStore('people', people);

  // ── Systems ──
  const sysSCADA = { id: P + 'sys-scada', orgId: orgElectric.id, name: 'SCADA', description: 'Supervisory Control And Data Acquisition — real-time grid telemetry.', systemType: 'OT', vendorName: 'GE', ownerPersonId: tobias.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  const sysCIS = { id: P + 'sys-cis', orgId: orgTidewater.id, name: 'CIS', description: 'Customer Information System — accounts, addresses, service history.', systemType: 'IT', vendorName: 'Oracle', ownerPersonId: andre.id, stewardIds: [natalie.id], createdAt: ts, updatedAt: ts };
  const sysAMI = { id: P + 'sys-ami', orgId: orgTidewater.id, name: 'AMI', description: 'Advanced Metering Infrastructure — interval reads from smart meters.', systemType: 'OT', vendorName: 'Itron', ownerPersonId: kwame.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  const sysOMS = { id: P + 'sys-oms', orgId: orgElectric.id, name: 'OMS', description: 'Outage Management System — event tracking, restoration workflows.', systemType: 'OT', vendorName: 'ABB', ownerPersonId: harold.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  const sysGIS = { id: P + 'sys-gis', orgId: orgTidewater.id, name: 'GIS', description: 'Geospatial Information System — assets in the field.', systemType: 'IT', vendorName: 'Esri', ownerPersonId: jennifer.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  const sysWarehouse = { id: P + 'sys-warehouse', orgId: orgTidewater.id, name: 'Data Warehouse', description: 'Enterprise analytics warehouse (Snowflake).', systemType: 'IT', vendorName: 'Snowflake', ownerPersonId: kwame.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  systems.push(sysSCADA, sysCIS, sysAMI, sysOMS, sysGIS, sysWarehouse);
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
  const domOps = { id: P + 'domain-ops', orgId: orgTidewater.id, name: 'Operational Data', description: 'Grid, generation, metering — the real-time and near-real-time operational feeds.', ownerId: jennifer.id, stewardIds: [brandon.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domRegulatory = { id: P + 'domain-regulatory', orgId: orgTidewater.id, name: 'Regulatory Data', description: 'Compliance evidence, filings, rate case data, NERC CIP + EPA SDWA.', ownerId: lorraine.id, stewardIds: [phillip.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  dataDomains.push(domCustomer, domOps, domRegulatory);

  // ── Data Assets (with domain inheritance where the pattern applies) ──
  const assetOutageLogs = { id: P + 'asset-outage-logs', orgId: orgElectric.id, name: 'Outage Logs', description: 'Per-event SCADA records of distribution outages.', systemId: sysSCADA.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 62, createdAt: ts, updatedAt: ts };
  const assetCustomerMaster = { id: P + 'asset-customer-master', orgId: orgTidewater.id, name: 'Customer Master', description: 'Service addresses, account status, billing terms.', systemId: sysCIS.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 88, createdAt: ts, updatedAt: ts };
  const assetMeterReads = { id: P + 'asset-meter-reads', orgId: orgTidewater.id, name: 'Meter Reads', description: 'AMI 15-minute interval consumption.', systemId: sysAMI.id, owner: '', ownerPersonId: andre.id, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 91, createdAt: ts, updatedAt: ts };
  const assetGeneration = { id: P + 'asset-generation-output', orgId: orgElectric.id, name: 'Generation Output', description: 'Plant-level MWh by hour.', systemId: sysSCADA.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 55, createdAt: ts, updatedAt: ts };
  // Planted orphans — obviously-named so Ask AI's "which data assets
  // have no process using them?" produces a quotable answer.
  const orphanLegacyBilling = { id: P + 'asset-legacy-billing', orgId: orgTidewater.id, name: 'Legacy Billing Extract', description: 'Nightly dump from the retired billing system. Kept as a fallback but no process references it.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  const orphanMeterCsv = { id: P + 'asset-meter-csv', orgId: orgTidewater.id, name: 'Meter CSV Dump', description: 'Ad-hoc CSV extract of yesterday\'s meter reads for an old vendor. Nobody remembers if it\'s still used.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  dataAssets.push(assetOutageLogs, assetCustomerMaster, assetMeterReads, assetGeneration, orphanLegacyBilling, orphanMeterCsv);
  saveStore('dataAssets', dataAssets);

  // Wire the domain → asset backrefs so the Domains page shows counts.
  domCustomer.dataAssetIds = [assetCustomerMaster.id];
  domOps.dataAssetIds = [assetOutageLogs.id, assetMeterReads.id, assetGeneration.id];
  saveStore('dataDomains', dataDomains);

  // ── Process hierarchy (Tidewater Electric) ──
  // Compact but meaningful: one value stream, two processes, one
  // sub-process per process, three activities. Enough to demo
  // Dependencies, BCM attributes, and mappings.
  const vs = { id: P + 'node-vs-outage', parentId: null, level: 'VALUE_STREAM' as const, name: 'Outage Management', description: 'End-to-end restoration flow — detect, dispatch, communicate, recover.', activityId: 'VS-DEMO-1', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procDetect = { id: P + 'node-proc-detect', parentId: vs.id, level: 'PROCESS' as const, name: 'Detect & Assess', description: 'Detect outages via SCADA + customer channel, triage severity.', activityId: 'PRO-DEMO-1', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procRestore = { id: P + 'node-proc-restore', parentId: vs.id, level: 'PROCESS' as const, name: 'Restore & Communicate', description: 'Dispatch crews, restore service, notify customers.', activityId: 'PRO-DEMO-2', status: 'ACTIVE', orderIndex: 1, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: samira.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spTriage = { id: P + 'node-sp-triage', parentId: procDetect.id, level: 'SUBPROCESS' as const, name: 'Outage Triage', description: 'Sort outages by criticality, allocate crews.', activityId: 'SP-DEMO-1', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actTriage = { id: P + 'node-act-triage', parentId: spTriage.id, level: 'ACTIVITY' as const, name: 'Outage triage', description: 'Classify incoming outages, dispatch first responders.', activityId: 'ACT-DEMO-1', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, responsibleRole: 'System Operator Lead', responsiblePersonId: melissa.id, systemIds: [sysSCADA.id, sysOMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Field crew on site within 30 minutes for Tier 1 outages', slaTarget: 'P95 30 min from detection', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actDispatch = { id: P + 'node-act-dispatch', parentId: procRestore.id, level: 'ACTIVITY' as const, name: 'Crew dispatch', description: 'Assign crews to outages by location + skill.', activityId: 'ACT-DEMO-2', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, responsibleRole: 'Line Superintendent', systemIds: [sysGIS.id, sysOMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actNotify = { id: P + 'node-act-notify', parentId: procRestore.id, level: 'ACTIVITY' as const, name: 'Customer notification sent', description: 'SMS/email/voice notifications to affected customers.', activityId: 'ACT-DEMO-3', status: 'ACTIVE', orderIndex: 1, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: samira.id, responsibleRole: 'Manager Contact Center', responsiblePersonId: samira.id, systemIds: [sysCIS.id], requiredSkillIds: [] as string[], version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  processNodes.push(vs, procDetect, procRestore, spTriage, actTriage, actDispatch, actNotify);
  saveStore('processNodes', processNodes);

  // ── Mappings ──
  mappings.push(
    { id: P + 'map-1', orgId: orgElectric.id, processStepId: actTriage.id, dataAssetId: assetOutageLogs.id, linkType: 'INPUT', notes: 'Consumes raw outage records', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: P + 'map-2', orgId: orgElectric.id, processStepId: actTriage.id, dataAssetId: assetCustomerMaster.id, linkType: 'INPUT', notes: 'Cross-references affected customers', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: P + 'map-3', orgId: orgElectric.id, processStepId: actNotify.id, dataAssetId: assetCustomerMaster.id, linkType: 'INPUT', notes: 'Pulls customer contact preferences', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: P + 'map-4', orgId: orgTidewater.id, processStepId: actDispatch.id, dataAssetId: assetMeterReads.id, linkType: 'INPUT', notes: 'Verifies restoration via meter reads', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
  );
  saveStore('mappings', mappings);

  // ── Governance tasks assigned to Susan (populates My Dashboard) ──
  governanceTasks.push(
    { id: P + 'task-1', orgId: orgTidewater.id, title: 'Approve Q3 data classification review', description: 'Review the AI-suggested sensitivity tags on Customer Master and Outage Logs and approve or reject each.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'HIGH' as any, assigneeId: susan.id, dueDate: daysFromNow(3), linkedObjectType: 'DataAsset', linkedObjectId: assetCustomerMaster.id, automationMode: 'HUMAN' as any, resolution: null, createdBy: marisol.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: P + 'task-2', orgId: orgTidewater.id, title: 'Sign off on Regulatory Data domain scope', description: 'Lorraine has proposed expanding the Regulatory Data domain to cover new SDWA reporting fields.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'MEDIUM' as any, assigneeId: susan.id, dueDate: daysFromNow(7), linkedObjectType: 'DataDomain', linkedObjectId: domRegulatory.id, automationMode: 'HUMAN' as any, resolution: null, createdBy: lorraine.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: P + 'task-3', orgId: orgTidewater.id, title: 'Retire Legacy Billing Extract or find its owner', description: 'This asset has been sitting orphaned for two quarters. Confirm it can go, or reassign it.', taskType: 'GENERAL' as any, status: 'OPEN' as any, priority: 'LOW' as any, assigneeId: susan.id, dueDate: daysFromNow(14), linkedObjectType: 'DataAsset', linkedObjectId: orphanLegacyBilling.id, automationMode: 'HUMAN' as any, resolution: null, createdBy: null, createdAt: ts, updatedAt: ts, completedAt: null },
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

  logger.info({ persona: susan.name }, 'Demo data seeded');

  return {
    organizations: 8,
    people: 16,
    systems: 6,
    agents: 5,
    dataDomains: 3,
    dataAssets: 6,
    processNodes: 7,
    mappings: 4,
    governanceTasks: 3,
    governanceIssues: 1,
    persona: { id: susan.id, name: susan.name },
  };
}
