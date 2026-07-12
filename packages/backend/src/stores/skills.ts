import { loadStore, registerStore } from '../lib/persistence';

// ──────────────────────────────────────────────────────────────────────────
// Skills store — the in-memory `skills` array, lifted out of routes so
// service code can read it without re-importing the route module. The
// route module also imports the array from here, so the cycle
// (routes/skills.ts ↔ services/skill-coverage.ts) is broken: both now
// depend only on this leaf module.
// ──────────────────────────────────────────────────────────────────────────

export const SKILL_CATEGORIES = [
  'DATA_QUALITY',
  'METADATA',
  'ARCHITECTURE',
  'SECURITY',
  'INTEGRATION',
  'ANALYTICS',
  'GOVERNANCE',
  'COMMUNICATION',
] as const;

export type SkillCategory = typeof SKILL_CATEGORIES[number];

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
registerStore('skills', skills);
