#!/usr/bin/env node
/**
 * Seed script — creates Huntington Ingalls Industries org hierarchy
 * with sample people for every DAMA governance role at corporate
 * and division levels.
 *
 * Run: node packages/backend/scripts/seed-hii-governance.js [BASE_URL]
 * Default BASE_URL: http://localhost:3000/api/v1
 */

const BASE = process.argv[2] || 'http://localhost:3000/api/v1';

let TOKEN;

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`POST ${path}: ${r.status} ${JSON.stringify(json)}`);
  return json.data;
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return (await r.json());
}

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@hii.com' }),
  });
  const json = await r.json();
  TOKEN = json.data.accessToken;
  console.log('Logged in');
}

// ── Role definitions ──
const DAMA_ROLES = [
  { roleType: 'CDO',                    title: 'Chief Data Officer',              category: 'Executive' },
  { roleType: 'DATA_GOVERNANCE_LEAD',   title: 'Data Governance Lead',            category: 'Executive' },
  { roleType: 'DATA_OWNER',             title: 'Data Owner',                      category: 'Business' },
  { roleType: 'BUSINESS_DATA_STEWARD',  title: 'Business Data Steward',           category: 'Business' },
  { roleType: 'DATA_QUALITY_ANALYST',   title: 'Data Quality Analyst',            category: 'Business' },
  { roleType: 'TECHNICAL_DATA_STEWARD', title: 'Technical Data Steward',          category: 'Technical' },
  { roleType: 'DATA_CUSTODIAN',         title: 'Data Custodian',                  category: 'Technical' },
  { roleType: 'DATA_ARCHITECT',         title: 'Data Architect',                  category: 'Technical' },
  { roleType: 'DATA_ENGINEER',          title: 'Data Engineer',                   category: 'Technical' },
  { roleType: 'DATABASE_ADMINISTRATOR', title: 'Database Administrator',          category: 'Technical' },
];

// ── People per org level ──
// Corporate-level people
const CORPORATE_PEOPLE = [
  { name: 'Tim Sanders',       roleType: 'CDO',                    email: 'tim.sanders@hii.com',       platformRole: 'SUPER_ADMIN' },
  { name: 'Rebecca Torres',    roleType: 'DATA_GOVERNANCE_LEAD',   email: 'rebecca.torres@hii.com',    platformRole: 'ORG_ADMIN' },
  { name: 'William Hayes',     roleType: 'DATA_OWNER',             email: 'william.hayes@hii.com',     platformRole: 'EDITOR' },
  { name: 'Sandra Mitchell',   roleType: 'BUSINESS_DATA_STEWARD',  email: 'sandra.mitchell@hii.com',   platformRole: 'EDITOR' },
  { name: 'Catherine Reeves',  roleType: 'DATA_QUALITY_ANALYST',   email: 'catherine.reeves@hii.com',  platformRole: 'CONTRIBUTOR' },
  { name: 'Paul Henderson',    roleType: 'TECHNICAL_DATA_STEWARD', email: 'paul.henderson@hii.com',    platformRole: 'EDITOR' },
  { name: 'Donald Perry',      roleType: 'DATA_CUSTODIAN',         email: 'donald.perry@hii.com',      platformRole: 'CONTRIBUTOR' },
  { name: 'Kenneth Brooks',    roleType: 'DATA_ARCHITECT',         email: 'kenneth.brooks@hii.com',    platformRole: 'EDITOR' },
  { name: 'Brian Patterson',   roleType: 'DATA_ENGINEER',          email: 'brian.patterson@hii.com',   platformRole: 'CONTRIBUTOR' },
  { name: 'Michelle Collins',  roleType: 'DATABASE_ADMINISTRATOR', email: 'michelle.collins@hii.com',  platformRole: 'CONTRIBUTOR' },
];

// Newport News Shipbuilding division people
const NNS_PEOPLE = [
  { name: 'Jonathan Carter',   roleType: 'CDO',                    email: 'jonathan.carter@nns.hii.com',   platformRole: 'ORG_ADMIN' },
  { name: 'Laura Simmons',     roleType: 'DATA_GOVERNANCE_LEAD',   email: 'laura.simmons@nns.hii.com',     platformRole: 'EDITOR' },
  { name: 'Gregory Foster',    roleType: 'DATA_OWNER',             email: 'gregory.foster@nns.hii.com',    platformRole: 'EDITOR' },
  { name: 'Deborah Russell',   roleType: 'BUSINESS_DATA_STEWARD',  email: 'deborah.russell@nns.hii.com',   platformRole: 'EDITOR' },
  { name: 'Andrea Griffin',    roleType: 'DATA_QUALITY_ANALYST',   email: 'andrea.griffin@nns.hii.com',    platformRole: 'CONTRIBUTOR' },
  { name: 'Christopher Ward',  roleType: 'TECHNICAL_DATA_STEWARD', email: 'christopher.ward@nns.hii.com',  platformRole: 'EDITOR' },
  { name: 'Joshua Bell',       roleType: 'DATA_CUSTODIAN',         email: 'joshua.bell@nns.hii.com',       platformRole: 'CONTRIBUTOR' },
  { name: 'Nicole Rivera',     roleType: 'DATA_ARCHITECT',         email: 'nicole.rivera@nns.hii.com',     platformRole: 'EDITOR' },
  { name: 'Eric Coleman',      roleType: 'DATA_ENGINEER',          email: 'eric.coleman@nns.hii.com',      platformRole: 'CONTRIBUTOR' },
  { name: 'Heather Powell',    roleType: 'DATABASE_ADMINISTRATOR', email: 'heather.powell@nns.hii.com',    platformRole: 'CONTRIBUTOR' },
];

// Ingalls Shipbuilding division people
const INGALLS_PEOPLE = [
  { name: 'Daniel Morgan',     roleType: 'CDO',                    email: 'daniel.morgan@ingalls.hii.com',     platformRole: 'ORG_ADMIN' },
  { name: 'Karen Sullivan',    roleType: 'DATA_GOVERNANCE_LEAD',   email: 'karen.sullivan@ingalls.hii.com',    platformRole: 'EDITOR' },
  { name: 'Steven Barnes',     roleType: 'DATA_OWNER',             email: 'steven.barnes@ingalls.hii.com',     platformRole: 'EDITOR' },
  { name: 'Pamela Howard',     roleType: 'BUSINESS_DATA_STEWARD',  email: 'pamela.howard@ingalls.hii.com',     platformRole: 'EDITOR' },
  { name: 'Christine Long',    roleType: 'DATA_QUALITY_ANALYST',   email: 'christine.long@ingalls.hii.com',    platformRole: 'CONTRIBUTOR' },
  { name: 'Matthew Reed',      roleType: 'TECHNICAL_DATA_STEWARD', email: 'matthew.reed@ingalls.hii.com',      platformRole: 'EDITOR' },
  { name: 'Tyler Cox',         roleType: 'DATA_CUSTODIAN',         email: 'tyler.cox@ingalls.hii.com',         platformRole: 'CONTRIBUTOR' },
  { name: 'Jessica Diaz',      roleType: 'DATA_ARCHITECT',         email: 'jessica.diaz@ingalls.hii.com',      platformRole: 'EDITOR' },
  { name: 'Brandon Campbell',  roleType: 'DATA_ENGINEER',          email: 'brandon.campbell@ingalls.hii.com',  platformRole: 'CONTRIBUTOR' },
  { name: 'Melissa Turner',    roleType: 'DATABASE_ADMINISTRATOR', email: 'melissa.turner@ingalls.hii.com',    platformRole: 'CONTRIBUTOR' },
];

// Mission Technologies division people
const MT_PEOPLE = [
  { name: 'Raymond Price',     roleType: 'CDO',                    email: 'raymond.price@mt.hii.com',     platformRole: 'ORG_ADMIN' },
  { name: 'Stephanie Butler',  roleType: 'DATA_GOVERNANCE_LEAD',   email: 'stephanie.butler@mt.hii.com',  platformRole: 'EDITOR' },
  { name: 'Patrick Murphy',    roleType: 'DATA_OWNER',             email: 'patrick.murphy@mt.hii.com',    platformRole: 'EDITOR' },
  { name: 'Amanda Jenkins',    roleType: 'BUSINESS_DATA_STEWARD',  email: 'amanda.jenkins@mt.hii.com',    platformRole: 'EDITOR' },
  { name: 'Kelly Sanders',     roleType: 'DATA_QUALITY_ANALYST',   email: 'kelly.sanders@mt.hii.com',     platformRole: 'CONTRIBUTOR' },
  { name: 'Scott Gonzalez',    roleType: 'TECHNICAL_DATA_STEWARD', email: 'scott.gonzalez@mt.hii.com',    platformRole: 'EDITOR' },
  { name: 'Aaron Hughes',      roleType: 'DATA_CUSTODIAN',         email: 'aaron.hughes@mt.hii.com',      platformRole: 'CONTRIBUTOR' },
  { name: 'Natalie Watson',    roleType: 'DATA_ARCHITECT',         email: 'natalie.watson@mt.hii.com',    platformRole: 'EDITOR' },
  { name: 'Derek Flores',      roleType: 'DATA_ENGINEER',          email: 'derek.flores@mt.hii.com',      platformRole: 'CONTRIBUTOR' },
  { name: 'Tiffany Ross',      roleType: 'DATABASE_ADMINISTRATOR', email: 'tiffany.ross@mt.hii.com',      platformRole: 'CONTRIBUTOR' },
];

async function main() {
  await login();

  // ── 1. Organization Hierarchy ──
  console.log('\n=== Organizations ===');
  const orgsRes = await get('/organizations');
  const allOrgs = orgsRes.data || [];

  // Corporate
  let company = allOrgs.find(o => o.name === 'Huntington Ingalls Industries' && o.type === 'company');
  if (!company) {
    company = await post('/organizations', {
      name: 'Huntington Ingalls Industries',
      type: 'company',
      industry: 'Defense & Shipbuilding',
      description: 'America\'s largest military shipbuilding company and a provider of professional services to partners in government and industry.',
    });
    console.log('Created: Huntington Ingalls Industries (corporate)');
  } else {
    console.log('Exists: Huntington Ingalls Industries');
  }
  const companyId = company.id;

  // Divisions
  const divisionDefs = [
    { name: 'Newport News Shipbuilding', description: 'Designs, builds, and maintains nuclear-powered aircraft carriers and submarines. Located in Newport News, Virginia.' },
    { name: 'Ingalls Shipbuilding',      description: 'Builds amphibious assault ships, destroyers, cutters, and other surface combatants. Located in Pascagoula, Mississippi.' },
    { name: 'Mission Technologies',      description: 'Provides mission-critical solutions in defense, intelligence, cyber, and unmanned systems.' },
  ];

  const divisions = {};
  for (const d of divisionDefs) {
    let div = allOrgs.find(o => o.name === d.name && o.type === 'division');
    if (!div) {
      div = await post('/organizations', {
        name: d.name,
        type: 'division',
        parentId: companyId,
        industry: 'Defense & Shipbuilding',
        description: d.description,
      });
      console.log(`  Created division: ${d.name}`);
    } else {
      console.log(`  Exists: ${d.name}`);
    }
    divisions[d.name] = div;
  }

  // ── 2. People & DAMA Role Assignments ──
  const existingPeople = (await get('/people')).data || [];

  async function createPeopleAndRoles(peopleDefs, orgId, orgName) {
    console.log(`\n=== People for ${orgName} ===`);
    for (const p of peopleDefs) {
      const roleInfo = DAMA_ROLES.find(r => r.roleType === p.roleType);
      const title = roleInfo ? roleInfo.title : p.roleType;

      // Create person
      let person = existingPeople.find(ep => ep.email === p.email);
      if (!person) {
        person = await post('/people', {
          name: p.name,
          email: p.email,
          role: p.platformRole,
          title: title,
          orgIds: [orgId],
          accessibleOrgIds: [orgId],
        });
        existingPeople.push(person); // track for dedup
        console.log(`  Created: ${p.name} — ${title} (${p.platformRole})`);
      } else {
        console.log(`  Exists: ${p.name}`);
      }

      // Assign DAMA role
      try {
        await post('/dama-roles', {
          personId: person.id,
          roleType: p.roleType,
          scopeType: 'ORG',
          scopeId: orgId,
        });
        console.log(`    Assigned: ${p.roleType} at ${orgName}`);
      } catch (err) {
        // Role may already exist — that's fine
        if (err.message.includes('already assigned') || err.message.includes('409')) {
          console.log(`    Already assigned: ${p.roleType}`);
        } else {
          console.log(`    Warning: ${err.message}`);
        }
      }
    }
  }

  await createPeopleAndRoles(CORPORATE_PEOPLE, companyId, 'Huntington Ingalls Industries');
  await createPeopleAndRoles(NNS_PEOPLE, divisions['Newport News Shipbuilding'].id, 'Newport News Shipbuilding');
  await createPeopleAndRoles(INGALLS_PEOPLE, divisions['Ingalls Shipbuilding'].id, 'Ingalls Shipbuilding');
  await createPeopleAndRoles(MT_PEOPLE, divisions['Mission Technologies'].id, 'Mission Technologies');

  // ── Summary ──
  const totalPeople = CORPORATE_PEOPLE.length + NNS_PEOPLE.length + INGALLS_PEOPLE.length + MT_PEOPLE.length;
  const totalRoles = totalPeople; // 1 role per person
  console.log(`\n=== Summary ===`);
  console.log(`Organizations: 1 company + 3 divisions = 4`);
  console.log(`People: ${totalPeople} (${DAMA_ROLES.length} roles × 4 org levels)`);
  console.log(`DAMA Role Assignments: ${totalRoles}`);
  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
