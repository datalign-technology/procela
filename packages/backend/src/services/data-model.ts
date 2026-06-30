/**
 * Logical Data Model (LDM)
 * ────────────────────────────────────────────────────────────────────────
 *
 * The shared description of Procela's domain in business terms. Every
 * surface that needs to talk about the model in user-friendly language
 * reads from here:
 *
 *   - Report Builder (Phase 2): drives the field / filter / group-by
 *     pickers and the join graph for cross-entity reports.
 *   - Future Postgres views / OData (Phase 3): the entity catalog is
 *     translated into SQL views and OData entity sets so external BI
 *     tools see the same business model the in-app UI does.
 *
 * The LDM intentionally uses business labels, not technical column
 * names. `Data Asset → Owner Name` matters more than
 * `data_asset.owner_person_id → people.name`. The translation
 * to the underlying API / table happens in the report-execution
 * layer, not here.
 *
 * This module is pure data — no IO, no state. Edits to add/remove
 * entities or fields are intentional design decisions and should
 * ship with a release-note line.
 */

export type LdmFieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'id';

export interface LdmField {
  /** Stable id used in report definitions. Do not rename without a
   *  migration: saved reports reference it. */
  id: string;
  /** Business label rendered in pickers and column headers. */
  label: string;
  /** One-line description shown as a tooltip in the report builder. */
  description: string;
  type: LdmFieldType;
  /** Values for `type: 'enum'` — surfaced as a dropdown in the filter UI. */
  enumValues?: readonly string[];
  /** Field can appear in WHERE / filter clauses. Defaults to true. */
  filterable?: boolean;
  /** Field can appear in GROUP BY / pivot rows. Defaults to true for
   *  enums and false for free-text strings (too high-cardinality). */
  groupable?: boolean;
  /** Hidden from default column lists but available on demand. Use for
   *  internal ids / audit timestamps that are rarely useful in a report. */
  advanced?: boolean;
}

export interface LdmRelationship {
  /** Stable id, also used as the field prefix when joined columns are
   *  surfaced (e.g. `owner.name → Owner Name`). */
  id: string;
  label: string;
  description: string;
  /** Target entity id. */
  target: string;
  /** Foreign-key field on this entity that points to the target. For
   *  many-to-many joins, the value is the bridge entity id (an LDM
   *  entity, not a raw table). */
  via: string;
  cardinality: 'one' | 'many';
}

export interface LdmEntity {
  /** Stable id used in report definitions and the metadata endpoint. */
  id: string;
  /** Plural business label — `Processes`, `Data Assets`. */
  label: string;
  /** Singular form — `Process`, `Data Asset`. Used by labels like
   *  "Owner: Tidewater Electric" in dynamic UI copy. */
  singular: string;
  description: string;
  /** Field id of the canonical name column — used by the report builder
   *  to render row headers and the default sort. */
  nameField: string;
  fields: readonly LdmField[];
  relationships: readonly LdmRelationship[];
}

// ── Helpers to keep entity definitions readable ──────────────────────────

const idField: LdmField = {
  id: 'id', label: 'ID',
  description: 'Internal identifier. Useful for joining to other entities.',
  type: 'id', groupable: false, advanced: true,
};

const orgIdField: LdmField = {
  id: 'orgId', label: 'Org ID',
  description: 'The organization this row belongs to. Most reports filter on the active org.',
  type: 'id', advanced: true,
};

const createdAtField: LdmField = {
  id: 'createdAt', label: 'Created At',
  description: 'When this row was first created.',
  type: 'date', groupable: false, advanced: true,
};

const updatedAtField: LdmField = {
  id: 'updatedAt', label: 'Updated At',
  description: 'When this row was last modified.',
  type: 'date', groupable: false, advanced: true,
};

// ── Entities ─────────────────────────────────────────────────────────────

const ENTITIES: LdmEntity[] = [
  {
    id: 'processNodes',
    label: 'Processes',
    singular: 'Process',
    description:
      'The process catalog — value streams, processes, sub-processes, activities, and tasks. The "what the business does" half of Procela.',
    nameField: 'name',
    fields: [
      idField, orgIdField,
      { id: 'name', label: 'Name', description: 'The activity / process name as it appears in the catalog.', type: 'string', groupable: false },
      { id: 'level', label: 'Level', description: 'Where the node sits in the hierarchy.', type: 'enum',
        enumValues: ['VALUE_STREAM', 'PROCESS', 'SUB_PROCESS', 'ACTIVITY', 'TASK'] },
      { id: 'status', label: 'Status', description: 'Lifecycle status.', type: 'enum',
        enumValues: ['DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'DEPRECATED'] },
      { id: 'description', label: 'Description', description: 'Long-form description.', type: 'string', groupable: false, advanced: true },
      { id: 'frequency', label: 'Frequency', description: 'How often the activity runs.', type: 'enum',
        enumValues: ['CONTINUOUS', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'AD_HOC'] },
      { id: 'riskLevel', label: 'Risk Level', description: 'Operational risk tier.', type: 'enum',
        enumValues: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
      { id: 'automationLevel', label: 'Automation Level', description: 'How automated the activity is today.', type: 'enum',
        enumValues: ['MANUAL', 'PARTIAL', 'AUTOMATED'] },
      { id: 'responsibleRole', label: 'Responsible Role', description: 'Free-text label for the role accountable.', type: 'string' },
      createdAtField, updatedAtField,
    ],
    relationships: [
      { id: 'org', label: 'Org', description: 'The org that owns this node.', target: 'organizations', via: 'orgId', cardinality: 'one' },
      { id: 'responsiblePerson', label: 'Responsible Person', description: 'The person on the hook for this activity.', target: 'people', via: 'responsiblePersonId', cardinality: 'one' },
      { id: 'requiredSkills', label: 'Required Skills', description: 'Skills an assignee needs to qualify for this activity.', target: 'skills', via: 'requiredSkillIds', cardinality: 'many' },
    ],
  },
  {
    id: 'dataAssets',
    label: 'Data Assets',
    singular: 'Data Asset',
    description:
      'Business-language data assets — customer master, billing records, outage logs. The "what data the business depends on" half.',
    nameField: 'name',
    fields: [
      idField, orgIdField,
      { id: 'name', label: 'Name', description: 'The asset name as users know it.', type: 'string', groupable: false },
      { id: 'description', label: 'Description', description: 'What the asset contains in business terms.', type: 'string', groupable: false, advanced: true },
      { id: 'dataType', label: 'Data Type', description: 'How the asset is used.', type: 'enum',
        enumValues: ['OPERATIONAL', 'GOVERNANCE', 'REFERENCE', 'ANALYTICAL', 'MASTER'] },
      { id: 'governanceTier', label: 'Governance Tier', description: 'Maturity: Bronze (uncertified), Silver (managed), Gold (certified).', type: 'enum',
        enumValues: ['BRONZE', 'SILVER', 'GOLD'] },
      { id: 'healthScore', label: 'Health Score', description: 'Composite quality score, 0–100.', type: 'number' },
      createdAtField, updatedAtField,
    ],
    relationships: [
      { id: 'org', label: 'Org', description: 'The org that owns this asset.', target: 'organizations', via: 'orgId', cardinality: 'one' },
      { id: 'owner', label: 'Owner', description: 'The person accountable for the asset.', target: 'people', via: 'ownerPersonId', cardinality: 'one' },
      { id: 'system', label: 'System of Record', description: 'The system that holds the canonical copy.', target: 'systems', via: 'systemId', cardinality: 'one' },
      { id: 'stewards', label: 'Stewards', description: 'People who curate the asset day-to-day.', target: 'people', via: 'stewardIds', cardinality: 'many' },
    ],
  },
  {
    id: 'systems',
    label: 'Systems',
    singular: 'System',
    description:
      'The applications and platforms where data lives — ERP, CRM, SCADA, GIS, data warehouses.',
    nameField: 'name',
    fields: [
      idField, orgIdField,
      { id: 'name', label: 'Name', description: 'The system name.', type: 'string', groupable: false },
      { id: 'description', label: 'Description', description: 'What the system does in business terms.', type: 'string', groupable: false, advanced: true },
      { id: 'systemType', label: 'Type', description: 'Category of system.', type: 'enum',
        enumValues: ['ERP', 'CRM', 'DATA_WAREHOUSE', 'OPERATIONAL', 'ANALYTICS', 'OTHER'] },
      createdAtField, updatedAtField,
    ],
    relationships: [
      { id: 'org', label: 'Org', description: 'The org that owns this system.', target: 'organizations', via: 'orgId', cardinality: 'one' },
      { id: 'owner', label: 'Owner', description: 'The person accountable for the system.', target: 'people', via: 'ownerPersonId', cardinality: 'one' },
      { id: 'deputyOwner', label: 'Deputy Owner', description: 'Backup owner.', target: 'people', via: 'deputyOwnerId', cardinality: 'one' },
      { id: 'custodians', label: 'Custodians', description: 'Operators on the system day-to-day.', target: 'people', via: 'custodianIds', cardinality: 'many' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    singular: 'Person',
    description:
      'Humans in the directory who hold ownership, stewardship, or any governance role.',
    nameField: 'name',
    fields: [
      idField,
      { id: 'name', label: 'Name', description: 'Full name.', type: 'string', groupable: false },
      { id: 'email', label: 'Email', description: 'Work email address.', type: 'string', groupable: false, advanced: true },
      { id: 'role', label: 'App Role', description: 'Procela platform role.', type: 'enum',
        enumValues: ['SUPER_ADMIN', 'ORG_ADMIN', 'EDITOR', 'CONTRIBUTOR', 'VIEWER'] },
      { id: 'title', label: 'Title', description: 'Job title.', type: 'string' },
      createdAtField, updatedAtField,
    ],
    relationships: [
      { id: 'orgs', label: 'Orgs', description: 'Org(s) this person belongs to.', target: 'organizations', via: 'orgIds', cardinality: 'many' },
      { id: 'skills', label: 'Skills', description: 'Skills this person holds.', target: 'skills', via: 'skillIds', cardinality: 'many' },
    ],
  },
  {
    id: 'organizations',
    label: 'Organizations',
    singular: 'Organization',
    description:
      'The company / division / department / team tree that scopes every other entity.',
    nameField: 'name',
    fields: [
      idField,
      { id: 'name', label: 'Name', description: 'Org name.', type: 'string', groupable: false },
      { id: 'type', label: 'Type', description: 'Level in the tree.', type: 'enum',
        enumValues: ['company', 'division', 'department', 'team', 'unit'] },
      { id: 'industry', label: 'Industry', description: 'Industry classification (company level).', type: 'string' },
      { id: 'description', label: 'Description', description: 'Free-text description.', type: 'string', groupable: false, advanced: true },
      createdAtField, updatedAtField,
    ],
    relationships: [
      { id: 'parent', label: 'Parent', description: 'Parent org in the tree.', target: 'organizations', via: 'parentId', cardinality: 'one' },
    ],
  },
  {
    id: 'mappings',
    label: 'Process–Data Mappings',
    singular: 'Mapping',
    description:
      'Links between process activities and the data assets they consume or produce. The bridge that lets you ask "which processes depend on this asset?"',
    nameField: 'id',
    fields: [
      idField, orgIdField,
      { id: 'linkType', label: 'Link Type', description: 'How the asset relates to the activity.', type: 'enum',
        enumValues: ['INPUT', 'OUTPUT', 'REFERENCE'] },
      { id: 'aiSuggested', label: 'AI Suggested', description: 'Whether the link came from an AI suggestion.', type: 'boolean' },
      { id: 'userOverridden', label: 'User Overridden', description: 'Whether a user modified the AI suggestion.', type: 'boolean' },
      { id: 'notes', label: 'Notes', description: 'Free-text notes on the mapping.', type: 'string', groupable: false, advanced: true },
      createdAtField,
    ],
    relationships: [
      { id: 'processStep', label: 'Process Step', description: 'The activity / task being linked.', target: 'processNodes', via: 'processStepId', cardinality: 'one' },
      { id: 'dataAsset', label: 'Data Asset', description: 'The asset being linked.', target: 'dataAssets', via: 'dataAssetId', cardinality: 'one' },
    ],
  },
  {
    id: 'dataDomains',
    label: 'Data Domains',
    singular: 'Data Domain',
    description:
      'Logical groupings of data assets (Customer, Financial, Asset, etc.). Each domain has an owner and stewards.',
    nameField: 'name',
    fields: [
      idField, orgIdField,
      { id: 'name', label: 'Name', description: 'Domain name.', type: 'string', groupable: false },
      { id: 'description', label: 'Description', description: 'What the domain covers.', type: 'string', groupable: false, advanced: true },
      createdAtField, updatedAtField,
    ],
    relationships: [
      { id: 'org', label: 'Org', description: 'Org that owns the domain.', target: 'organizations', via: 'orgId', cardinality: 'one' },
      { id: 'owner', label: 'Owner', description: 'Domain owner.', target: 'people', via: 'ownerId', cardinality: 'one' },
      { id: 'stewards', label: 'Stewards', description: 'Domain stewards.', target: 'people', via: 'stewardIds', cardinality: 'many' },
    ],
  },
  {
    id: 'damaRoles',
    label: 'Role Assignments',
    singular: 'Role Assignment',
    description:
      'The standing DAMA / governance roles held by each person — Data Owner, Steward, CDO, etc. One row per (person, role, scope).',
    nameField: 'roleType',
    fields: [
      idField, orgIdField,
      { id: 'roleType', label: 'Role', description: 'The governance role.', type: 'string' },
      { id: 'scopeType', label: 'Scope Type', description: 'What the role is scoped to.', type: 'enum',
        enumValues: ['ORG', 'DOMAIN', 'SYSTEM', 'DATA_ASSET'] },
      { id: 'since', label: 'Since', description: 'When the assignment started.', type: 'date' },
    ],
    relationships: [
      { id: 'person', label: 'Person', description: 'Person holding the role.', target: 'people', via: 'personId', cardinality: 'one' },
      { id: 'org', label: 'Org', description: 'Org the role is held in.', target: 'organizations', via: 'orgId', cardinality: 'one' },
    ],
  },
  {
    id: 'skills',
    label: 'Skills',
    singular: 'Skill',
    description:
      'DAMA-aligned competencies held by people and required by activities.',
    nameField: 'name',
    fields: [
      idField, orgIdField,
      { id: 'name', label: 'Name', description: 'Skill name.', type: 'string', groupable: false },
      { id: 'category', label: 'Category', description: 'Skill category.', type: 'enum',
        enumValues: ['DATA_QUALITY', 'METADATA', 'ARCHITECTURE', 'SECURITY', 'INTEGRATION', 'ANALYTICS', 'GOVERNANCE', 'COMMUNICATION'] },
      { id: 'description', label: 'Description', description: 'What the skill covers.', type: 'string', groupable: false, advanced: true },
      createdAtField, updatedAtField,
    ],
    relationships: [],
  },
];

// ── Public accessors ─────────────────────────────────────────────────────

export function listEntities(): LdmEntity[] {
  return ENTITIES;
}

export function getEntity(id: string): LdmEntity | undefined {
  return ENTITIES.find((e) => e.id === id);
}

/** Snapshot of the whole catalog with a tiny version tag, for the
 *  /metadata endpoint. Versioning lets the frontend invalidate cached
 *  copies when the LDM changes meaningfully. */
export const LDM_VERSION = '1.0.0';

export function getCatalog(): { version: string; entities: LdmEntity[] } {
  return { version: LDM_VERSION, entities: ENTITIES };
}
