import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// Skills — DAMA-aligned capabilities that agents (and people) can possess.
// Phase 1 of the AI agent automation feature. Each skill belongs to a
// category and an org; the seed endpoint populates a standard taxonomy.
// ──────────────────────────────────────────────────────────────────────────

const SKILL_CATEGORIES = [
  'DATA_QUALITY',
  'METADATA',
  'ARCHITECTURE',
  'SECURITY',
  'INTEGRATION',
  'ANALYTICS',
  'GOVERNANCE',
  'COMMUNICATION',
] as const;

type SkillCategory = typeof SKILL_CATEGORIES[number];

export interface StoredSkill {
  id: string;
  orgId: string;
  name: string;
  category: SkillCategory;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export const skills: StoredSkill[] = loadStore<StoredSkill>('skills');

const router = Router();

// ── Standard DAMA-aligned seed skills ────────────────────────────────────

const SEED_SKILLS: Array<{ name: string; category: SkillCategory; description: string }> = [
  // DATA_QUALITY
  { name: 'Data Profiling', category: 'DATA_QUALITY', description: 'Analyze data sets to collect statistics and information about data quality, structure, and content.' },
  { name: 'Data Cleansing', category: 'DATA_QUALITY', description: 'Detect and correct (or remove) corrupt, inaccurate, or irrelevant records from a data set.' },
  { name: 'Rule Authoring', category: 'DATA_QUALITY', description: 'Define and maintain business rules that validate data quality expectations.' },
  { name: 'Anomaly Detection', category: 'DATA_QUALITY', description: 'Identify unexpected patterns, outliers, or deviations in data that may indicate quality issues.' },
  { name: 'Quality Monitoring', category: 'DATA_QUALITY', description: 'Continuously track data quality metrics and alert on threshold breaches.' },

  // METADATA
  { name: 'Metadata Management', category: 'METADATA', description: 'Organize, store, and maintain metadata across enterprise data assets.' },
  { name: 'Data Cataloging', category: 'METADATA', description: 'Discover, inventory, and classify data assets into a searchable catalog.' },
  { name: 'Lineage Mapping', category: 'METADATA', description: 'Trace and document the flow of data from source to destination across systems.' },
  { name: 'Schema Validation', category: 'METADATA', description: 'Verify that data structures conform to expected schemas and formats.' },
  { name: 'Tag Management', category: 'METADATA', description: 'Apply, maintain, and govern classification tags on data assets.' },

  // ARCHITECTURE
  { name: 'Data Modeling', category: 'ARCHITECTURE', description: 'Design logical and physical data models that support business requirements.' },
  { name: 'Integration Design', category: 'ARCHITECTURE', description: 'Architect data integration patterns and data flow between systems.' },
  { name: 'API Management', category: 'ARCHITECTURE', description: 'Design, publish, and govern APIs for data access and exchange.' },
  { name: 'Cloud Architecture', category: 'ARCHITECTURE', description: 'Design and optimize cloud-based data infrastructure and services.' },
  { name: 'Performance Tuning', category: 'ARCHITECTURE', description: 'Optimize data systems for query performance, throughput, and resource utilization.' },

  // SECURITY
  { name: 'Access Control', category: 'SECURITY', description: 'Manage authentication and authorization policies for data access.' },
  { name: 'Data Classification', category: 'SECURITY', description: 'Categorize data by sensitivity level to apply appropriate protection controls.' },
  { name: 'Encryption Management', category: 'SECURITY', description: 'Implement and manage encryption for data at rest and in transit.' },
  { name: 'Privacy Compliance', category: 'SECURITY', description: 'Ensure data handling practices comply with privacy regulations (GDPR, CCPA, etc.).' },
  { name: 'Audit Trail Management', category: 'SECURITY', description: 'Maintain comprehensive logs of data access and modifications for compliance.' },

  // INTEGRATION
  { name: 'ETL Development', category: 'INTEGRATION', description: 'Build and maintain extract, transform, and load pipelines for data movement.' },
  { name: 'API Integration', category: 'INTEGRATION', description: 'Connect systems through API-based data exchange and synchronization.' },
  { name: 'Real-time Streaming', category: 'INTEGRATION', description: 'Implement real-time data streaming and event-driven integration patterns.' },
  { name: 'File Transfer', category: 'INTEGRATION', description: 'Manage secure file-based data transfers between systems and partners.' },
  { name: 'Data Replication', category: 'INTEGRATION', description: 'Replicate data across systems for availability, disaster recovery, or analytics.' },

  // ANALYTICS
  { name: 'Report Development', category: 'ANALYTICS', description: 'Create and maintain operational and analytical reports for stakeholders.' },
  { name: 'Dashboard Design', category: 'ANALYTICS', description: 'Design interactive dashboards that visualize key metrics and KPIs.' },
  { name: 'Statistical Analysis', category: 'ANALYTICS', description: 'Apply statistical methods to extract insights from data sets.' },
  { name: 'Data Visualization', category: 'ANALYTICS', description: 'Transform data into visual representations that communicate findings effectively.' },
  { name: 'Predictive Modeling', category: 'ANALYTICS', description: 'Build models that forecast future outcomes based on historical data patterns.' },

  // GOVERNANCE
  { name: 'Policy Development', category: 'GOVERNANCE', description: 'Draft and maintain data governance policies, standards, and procedures.' },
  { name: 'Standards Enforcement', category: 'GOVERNANCE', description: 'Monitor and enforce compliance with data governance standards across the organization.' },
  { name: 'Issue Resolution', category: 'GOVERNANCE', description: 'Investigate and resolve data governance issues and escalations.' },
  { name: 'Change Management', category: 'GOVERNANCE', description: 'Manage controlled changes to data assets, schemas, and governance processes.' },
  { name: 'Compliance Monitoring', category: 'GOVERNANCE', description: 'Track regulatory and policy compliance across data management activities.' },

  // COMMUNICATION
  { name: 'Stakeholder Management', category: 'COMMUNICATION', description: 'Engage and align stakeholders on data governance initiatives and priorities.' },
  { name: 'Training Delivery', category: 'COMMUNICATION', description: 'Develop and deliver training on data governance practices and tools.' },
  { name: 'Documentation', category: 'COMMUNICATION', description: 'Create and maintain documentation for data processes, standards, and systems.' },
  { name: 'Business Translation', category: 'COMMUNICATION', description: 'Translate between technical data concepts and business language for stakeholders.' },
  { name: 'Executive Reporting', category: 'COMMUNICATION', description: 'Prepare executive-level summaries and presentations on data governance outcomes.' },
];

/** GET /api/v1/skills — list all skills, optionally filtered by ?orgId= */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? skills.filter((s) => s.orgId === orgId) : skills;
  res.json({
    success: true,
    data: filtered,
    categories: SKILL_CATEGORIES,
  });
});

/** GET /api/v1/skills/:id */
router.get('/:id', (req: Request, res: Response) => {
  const skill = skills.find((s) => s.id === req.params.id);
  if (!skill) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }
  res.json({ success: true, data: skill });
});

/** POST /api/v1/skills — create a skill */
router.post('/', (req: Request, res: Response) => {
  const { orgId, name, category, description } = req.body;
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  const resolvedCategory: SkillCategory = SKILL_CATEGORIES.includes(category) ? category : 'GOVERNANCE';
  const now = new Date().toISOString();
  const skill: StoredSkill = {
    id: uuid(),
    orgId,
    name,
    category: resolvedCategory,
    description: description || '',
    createdAt: now,
    updatedAt: now,
  };
  skills.push(skill);
  saveStore('skills', skills);
  res.status(201).json({ success: true, data: skill });
});

/** POST /api/v1/skills/seed — seed standard DAMA-aligned skills for an org */
router.post('/seed', (req: Request, res: Response) => {
  const { orgId } = req.body;
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  const now = new Date().toISOString();
  const created: StoredSkill[] = [];
  for (const seed of SEED_SKILLS) {
    // Skip if a skill with the same name already exists for this org
    if (skills.find((s) => s.orgId === orgId && s.name === seed.name)) continue;
    const skill: StoredSkill = {
      id: uuid(),
      orgId,
      name: seed.name,
      category: seed.category,
      description: seed.description,
      createdAt: now,
      updatedAt: now,
    };
    skills.push(skill);
    created.push(skill);
  }
  saveStore('skills', skills);
  logger.info({ created: created.length, orgId }, 'Seeded DAMA skills');
  res.status(201).json({ success: true, data: created, message: `Seeded ${created.length} skills` });
});

/** PUT /api/v1/skills/:id — update a skill */
router.put('/:id', (req: Request, res: Response) => {
  const skill = skills.find((s) => s.id === req.params.id);
  if (!skill) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }
  const { name, category, description } = req.body;
  if (name !== undefined) skill.name = name;
  if (category !== undefined && SKILL_CATEGORIES.includes(category)) skill.category = category;
  if (description !== undefined) skill.description = description;
  skill.updatedAt = new Date().toISOString();
  saveStore('skills', skills);
  res.json({ success: true, data: skill });
});

/** DELETE /api/v1/skills/:id — delete a skill */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = skills.findIndex((s) => s.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }
  skills.splice(idx, 1);
  saveStore('skills', skills);
  res.status(204).send();
});

export default router;
