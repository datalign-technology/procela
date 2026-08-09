#!/usr/bin/env node
/**
 * Seed script — creates realistic test data for Tidewater Utilities.
 * Run: node packages/backend/scripts/seed-tidewater.js [BASE_URL]
 * Default BASE_URL: http://localhost:3000/api/v1
 */

const BASE = process.argv[2] || 'http://localhost:3000/api/v1';

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`POST ${path}: ${JSON.stringify(json)}`);
  return json.data;
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return (await r.json());
}

let TOKEN;

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@tidewater-utilities.com' }),
  });
  const json = await r.json();
  TOKEN = json.data.accessToken;
  console.log('Logged in');
}

async function main() {
  await login();

  // 1. Find or create Tidewater Utilities org hierarchy
  const orgsRes = await get('/organizations');
  const allOrgs = orgsRes.data || [];
  let company = allOrgs.find(o => o.name === 'Tidewater Utilities' && o.type === 'company');
  if (!company) {
    company = await post('/organizations', { name: 'Tidewater Utilities', type: 'company', industry: 'Utilities (Electric, Gas, Water)', description: 'Multi-utility holding company serving the Mid-Atlantic region' });
    console.log('Created Tidewater Utilities');
  } else {
    console.log('Tidewater Utilities exists');
  }
  const companyId = company.id;

  // Divisions
  const divisionDefs = [
    { name: 'Tidewater Electric', description: 'Electric generation, transmission, and distribution' },
    { name: 'Tidewater Water', description: 'Water production, distribution, and wastewater' },
    { name: 'Shared Services', description: 'IT, Finance, HR, Legal, and Regulatory support' },
  ];
  const divisions = {};
  for (const d of divisionDefs) {
    let div = allOrgs.find(o => o.name === d.name && o.type === 'division');
    if (!div) {
      div = await post('/organizations', { name: d.name, type: 'division', parentId: companyId, description: d.description, industry: 'Utilities (Electric, Gas, Water)' });
      console.log(`  Created division: ${d.name}`);
    }
    divisions[d.name] = div;
  }

  // Departments
  const deptDefs = [
    { div: 'Tidewater Electric', depts: ['Power Generation', 'Transmission & Distribution', 'Electric Customer Service', 'Electric Engineering', 'Electric Asset Management'] },
    { div: 'Tidewater Water', depts: ['Water Production', 'Water Distribution', 'Wastewater Operations', 'Water Customer Service', 'Water Engineering'] },
    { div: 'Shared Services', depts: ['Information Technology', 'Finance & Accounting', 'Human Resources', 'Regulatory Affairs', 'Safety & Environmental'] },
  ];
  const departments = {};
  for (const dd of deptDefs) {
    for (const deptName of dd.depts) {
      let dept = allOrgs.find(o => o.name === deptName && o.type === 'department');
      if (!dept) {
        dept = await post('/organizations', { name: deptName, type: 'department', parentId: divisions[dd.div].id, description: `${deptName} department under ${dd.div}` });
        console.log(`    Created dept: ${deptName}`);
      }
      departments[deptName] = dept;
    }
  }

  // 2. People — across divisions
  const peopleDefs = [
    { name: 'Eleanor Briggs', email: 'eleanor.briggs@tidewater-utilities.com', role: 'SUPER_ADMIN', title: 'Chief Executive Officer', orgIds: [companyId] },
    { name: 'Susan Chen', email: 'susan.chen@tidewater-utilities.com', role: 'EDITOR', title: 'Chief Data Officer', orgIds: [companyId] },
    { name: 'Marcus Williams', email: 'marcus.williams@tidewater-utilities.com', role: 'ORG_ADMIN', title: 'VP of Electric Operations', orgIds: [divisions['Tidewater Electric'].id] },
    { name: 'Patricia Hernandez', email: 'patricia.hernandez@tidewater-utilities.com', role: 'ORG_ADMIN', title: 'VP of Water Operations', orgIds: [divisions['Tidewater Water'].id] },
    { name: 'Robert Kim', email: 'robert.kim@tidewater-utilities.com', role: 'ORG_ADMIN', title: 'VP of Shared Services', orgIds: [divisions['Shared Services'].id] },
    { name: 'Angela Foster', email: 'angela.foster@tidewater-utilities.com', role: 'EDITOR', title: 'Director of Power Generation', orgIds: [departments['Power Generation'].id] },
    { name: 'James Rodriguez', email: 'james.rodriguez@tidewater-utilities.com', role: 'EDITOR', title: 'Director of T&D', orgIds: [departments['Transmission & Distribution'].id] },
    { name: 'Diana Patel', email: 'diana.patel@tidewater-utilities.com', role: 'EDITOR', title: 'Director of Water Production', orgIds: [departments['Water Production'].id] },
    { name: 'Kevin O\'Brien', email: 'kevin.obrien@tidewater-utilities.com', role: 'EDITOR', title: 'Director of IT', orgIds: [departments['Information Technology'].id] },
    { name: 'Sarah Mitchell', email: 'sarah.mitchell@tidewater-utilities.com', role: 'EDITOR', title: 'Director of Finance', orgIds: [departments['Finance & Accounting'].id] },
    { name: 'David Chang', email: 'david.chang@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Senior Data Analyst', orgIds: [departments['Information Technology'].id] },
    { name: 'Lisa Thompson', email: 'lisa.thompson@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Data Governance Analyst', orgIds: [companyId] },
    { name: 'Michael Brooks', email: 'michael.brooks@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Electric Systems Engineer', orgIds: [departments['Electric Engineering'].id] },
    { name: 'Jennifer Walsh', email: 'jennifer.walsh@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Water Quality Specialist', orgIds: [departments['Water Production'].id] },
    { name: 'Thomas Park', email: 'thomas.park@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Regulatory Compliance Manager', orgIds: [departments['Regulatory Affairs'].id] },
    { name: 'Rachel Green', email: 'rachel.green@tidewater-utilities.com', role: 'VIEWER', title: 'HR Business Partner', orgIds: [departments['Human Resources'].id] },
    { name: 'Carlos Mendez', email: 'carlos.mendez@tidewater-utilities.com', role: 'VIEWER', title: 'Safety Coordinator', orgIds: [departments['Safety & Environmental'].id] },
    { name: 'Amy Nguyen', email: 'amy.nguyen@tidewater-utilities.com', role: 'VIEWER', title: 'Customer Service Manager', orgIds: [departments['Electric Customer Service'].id, departments['Water Customer Service'].id] },
  ];

  const existingPeople = (await get('/people')).data || [];
  const createdPeople = {};
  for (const p of peopleDefs) {
    let person = existingPeople.find(ep => ep.email === p.email);
    if (!person) {
      person = await post('/people', p);
      console.log(`  Created person: ${p.name} (${p.role})`);
    }
    createdPeople[p.name] = person;
  }

  // 3. Systems
  const systemDefs = [
    { name: 'SAP ERP', systemType: 'ERP', businessCriticality: 'HIGH', vendor: 'SAP', integrationPoints: 'Connects to GIS, CIS, SCADA via middleware', orgId: companyId, description: 'Enterprise resource planning — finance, procurement, asset management' },
    { name: 'Oracle CIS', systemType: 'CRM', businessCriticality: 'HIGH', vendor: 'Oracle', integrationPoints: 'Feeds billing data to SAP, receives meter reads from MDM', orgId: companyId, description: 'Customer information system — billing, accounts, service orders' },
    { name: 'ESRI ArcGIS', systemType: 'GIS', businessCriticality: 'MEDIUM', vendor: 'ESRI', integrationPoints: 'Feeds asset locations to SAP PM, receives outage data from OMS', orgId: companyId, description: 'Geographic information system — network mapping, asset locations' },
    { name: 'OSIsoft PI', systemType: 'SCADA', businessCriticality: 'HIGH', vendor: 'AVEVA', integrationPoints: 'Collects real-time data from field devices, feeds analytics platform', orgId: divisions['Tidewater Electric'].id, description: 'Real-time data historian for generation and T&D operations' },
    { name: 'Itron MDM', systemType: 'Other', businessCriticality: 'HIGH', vendor: 'Itron', integrationPoints: 'Receives AMI meter reads, feeds CIS for billing', orgId: companyId, description: 'Meter data management — AMI data collection and validation' },
    { name: 'Maximo', systemType: 'Asset Management', businessCriticality: 'MEDIUM', vendor: 'IBM', integrationPoints: 'Syncs work orders with SAP PM, receives GIS asset data', orgId: companyId, description: 'Asset management and work order system' },
    { name: 'Snowflake DW', systemType: 'Data Warehouse', businessCriticality: 'MEDIUM', vendor: 'Snowflake', integrationPoints: 'Ingests from SAP, CIS, SCADA, GIS nightly', orgId: divisions['Shared Services'].id, description: 'Enterprise data warehouse for analytics and reporting' },
    { name: 'Power BI', systemType: 'Business Intelligence', businessCriticality: 'LOW', vendor: 'Microsoft', integrationPoints: 'Reads from Snowflake DW', orgId: divisions['Shared Services'].id, description: 'Self-service analytics and executive dashboards' },
    { name: 'SharePoint', systemType: 'Document Management', businessCriticality: 'LOW', vendor: 'Microsoft', integrationPoints: 'Stores process documentation, SOPs, policies', orgId: divisions['Shared Services'].id, description: 'Document management and collaboration platform' },
    { name: 'HRIS Workday', systemType: 'HRIS', businessCriticality: 'MEDIUM', vendor: 'Workday', integrationPoints: 'Syncs employee data to Active Directory', orgId: divisions['Shared Services'].id, description: 'Human resource information system' },
  ];

  const existingSystems = (await get('/systems')).data || [];
  const createdSystems = {};
  for (const s of systemDefs) {
    let sys = existingSystems.find(es => es.name === s.name);
    if (!sys) {
      sys = await post('/systems', s);
      console.log(`  Created system: ${s.name}`);
    }
    createdSystems[s.name] = sys;
  }

  // 4. Data Assets
  const assetDefs = [
    { name: 'Customer Account Data', description: 'Customer accounts, addresses, contact info, service agreements', systemId: createdSystems['Oracle CIS'].id, governanceTier: 'GOLD', retentionPolicy: '7 years after account closure', refreshFrequency: 'DAILY', orgId: companyId },
    { name: 'Billing Records', description: 'Monthly billing cycles, charges, payments, adjustments', systemId: createdSystems['Oracle CIS'].id, governanceTier: 'GOLD', retentionPolicy: '7 years per SOX', refreshFrequency: 'DAILY', orgId: companyId },
    { name: 'Meter Reading Data', description: 'AMI interval reads, demand data, tamper alerts', systemId: createdSystems['Itron MDM'].id, governanceTier: 'SILVER', retentionPolicy: '5 years', refreshFrequency: 'REAL_TIME', orgId: companyId },
    { name: 'Asset Registry', description: 'Poles, transformers, pipes, valves, pumps — all utility infrastructure', systemId: createdSystems['Maximo'].id, governanceTier: 'SILVER', retentionPolicy: 'Life of asset + 5 years', refreshFrequency: 'DAILY', orgId: companyId },
    { name: 'GIS Network Model', description: 'Geospatial network topology — lines, substations, pressure zones', systemId: createdSystems['ESRI ArcGIS'].id, governanceTier: 'SILVER', retentionPolicy: 'Indefinite', refreshFrequency: 'WEEKLY', orgId: companyId },
    { name: 'SCADA Telemetry', description: 'Real-time sensor data — voltage, flow, pressure, temperature', systemId: createdSystems['OSIsoft PI'].id, governanceTier: 'BRONZE', retentionPolicy: '3 years detailed, 10 years aggregated', refreshFrequency: 'REAL_TIME', orgId: divisions['Tidewater Electric'].id },
    { name: 'Work Order History', description: 'Maintenance work orders, inspections, repairs, crew assignments', systemId: createdSystems['Maximo'].id, governanceTier: 'SILVER', retentionPolicy: '10 years', refreshFrequency: 'DAILY', orgId: companyId },
    { name: 'Financial Transactions', description: 'GL postings, AP/AR, cost centers, budgets', systemId: createdSystems['SAP ERP'].id, governanceTier: 'GOLD', retentionPolicy: '7 years per SOX', refreshFrequency: 'DAILY', orgId: divisions['Shared Services'].id },
    { name: 'Employee Records', description: 'Employee demographics, positions, compensation, certifications', systemId: createdSystems['HRIS Workday'].id, governanceTier: 'GOLD', retentionPolicy: '7 years after termination', refreshFrequency: 'DAILY', orgId: divisions['Shared Services'].id },
    { name: 'Water Quality Results', description: 'Lab test results — turbidity, chlorine, bacteria, pH, lead/copper', systemId: null, governanceTier: 'GOLD', retentionPolicy: '10 years per EPA regulation', refreshFrequency: 'DAILY', orgId: divisions['Tidewater Water'].id },
    { name: 'Outage Management Data', description: 'Outage events, affected customers, crew dispatch, restoration times', systemId: null, governanceTier: 'SILVER', retentionPolicy: '5 years', refreshFrequency: 'REAL_TIME', orgId: divisions['Tidewater Electric'].id },
    { name: 'Regulatory Filings', description: 'Rate cases, compliance reports, environmental permits', systemId: createdSystems['SharePoint'].id, governanceTier: 'GOLD', retentionPolicy: 'Indefinite', refreshFrequency: 'MANUAL', orgId: divisions['Shared Services'].id },
  ];

  const existingAssets = (await get('/data-assets')).data || [];
  const createdAssets = {};
  for (const a of assetDefs) {
    let asset = existingAssets.find(ea => ea.name === a.name);
    if (!asset) {
      asset = await post('/data-assets', a);
      console.log(`  Created asset: ${a.name} (${a.governanceTier})`);
    }
    createdAssets[a.name] = asset;
  }

  // 5. Data Domains
  const domainDefs = [
    { name: 'Customer Data', description: 'All customer-facing data: accounts, billing, service, communications', scopeDefinition: 'Any data that identifies or describes a utility customer or their service relationship', orgId: companyId },
    { name: 'Operational Data', description: 'Data supporting field operations, asset management, and network operations', scopeDefinition: 'Data from SCADA, GIS, work orders, outage management, and asset registries', orgId: companyId },
    { name: 'Financial Data', description: 'Financial transactions, budgets, cost accounting, regulatory filings', scopeDefinition: 'GL, AP/AR, billing revenue, capital projects, rate case data', orgId: divisions['Shared Services'].id },
    { name: 'Employee Data', description: 'Workforce information including HR, safety, training, and compliance', scopeDefinition: 'Employee PII, certifications, safety incidents, training records', orgId: divisions['Shared Services'].id },
    { name: 'Environmental & Compliance', description: 'Regulatory compliance data, environmental monitoring, permits', scopeDefinition: 'Water quality, emissions, EPA/state filings, permit conditions', orgId: companyId },
  ];

  const existingDomains = (await get('/data-domains')).data || [];
  for (const dd of domainDefs) {
    if (!existingDomains.find(ed => ed.name === dd.name)) {
      await post('/data-domains', dd);
      console.log(`  Created domain: ${dd.name}`);
    }
  }

  console.log('\n✓ Seed complete!');
  console.log(`  ${Object.keys(createdPeople).length} people`);
  console.log(`  ${Object.keys(createdSystems).length} systems`);
  console.log(`  ${Object.keys(createdAssets).length} data assets`);
  console.log(`  ${domainDefs.length} data domains`);

  // Cleanup — kill the test server if we started one
  kill();
}

function kill() {
  try { process.exit(0); } catch { /* */ }
}

main().catch((e) => { console.error('Seed failed:', e.message); kill(); });
