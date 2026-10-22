// ──────────────────────────────────────────────────────────────────────────
// Roadmap / status data — the structured form of docs/STATUS.md (the single
// source of truth) that drives the interactive Status & Roadmap dashboard.
// When STATUS.md moves, update these figures to match; the "Reference" tab on
// the page links through to the full rendered document.
// Last reconciled: 2026-09-19.
// ──────────────────────────────────────────────────────────────────────────

export type RoadmapState =
  | 'Shipped' | 'Done' | 'In progress' | 'Partial' | 'Designed' | 'Not started' | 'Open';

export const ROADMAP_LAST_RECONCILED = 'Sep 19, 2026';

export const ROADMAP_SNAPSHOT = {
  capabilities: { built: 68, partial: 4, designed: 2, notStarted: 9, total: 83 },
  checklist: { done: 7, partial: 4, open: 16, total: 27 },
  openP0: { count: 3, summary: 'Hosting, connector pilot, pilot kit' },
};

export interface RoadmapTrack { id: string; name: string; state: RoadmapState; note: string; }
export const ROADMAP_TRACKS: RoadmapTrack[] = [
  { id: 'A', name: 'Phase 3: close the discovery loop', state: 'In progress', note: 'The discovery loop is closed for direct-connect sources; only the real-customer connector pilot (A1) remains open.' },
  { id: 'B', name: 'Production-scale hardening', state: 'In progress', note: 'Go-live tail gated on a running deploy: HA Postgres, on-prem smoke deploy, load-test baseline, external pen test and a DR rehearsal are still outstanding.' },
  { id: 'C', name: 'Commercial SaaS readiness', state: 'Not started', note: 'Billing, self-serve org onboarding and legal content are genuinely absent and built only if go-to-market is self-serve SaaS.' },
  { id: 'D', name: 'Canonical data-model gaps', state: 'In progress', note: 'Most gaps are built; Business Capability level, co-stewardship register, domain/asset versioning and source-scope→domain auto-mapping are still open.' },
  { id: 'E', name: 'Non-relational source discovery', state: 'Shipped', note: 'E1–E4 all shipped (object storage, MongoDB, warehouses, local files incl. Parquet/Avro run real introspection); only live-account validation remains, with API/spreadsheet still simulated.' },
  { id: 'F', name: 'Adoption & buyer motion', state: 'Not started', note: 'The adoption/change-management playbook (F1) and the design-partner paid-pilot kit (F2) are both not started.' },
];

export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export interface OpenWorkItem { name: string; track: string; priority: Priority; state: RoadmapState; next: string; }
export const ROADMAP_OPEN_WORK: OpenWorkItem[] = [
  { name: 'Multi-tenant SaaS hosting', track: 'Track C', priority: 'P0', state: 'Designed', next: 'Stand up a production environment (#20/#26); architecture is done but nothing is deployed.' },
  { name: 'Real-customer connector pilot (A1)', track: 'Track A', priority: 'P0', state: 'In progress', next: 'Run the shipped edge agent against a live customer database (#25) as a paid, time-boxed design-partner engagement.' },
  { name: 'Design-partner pilot kit', track: 'Track F2', priority: 'P0', state: 'Not started', next: 'Package A1 as a paid, time-boxed pilot with acceptance criteria plus a security-questionnaire/DPA pack.' },
  { name: 'Adoption / change-management playbook', track: 'Track F1', priority: 'P1', state: 'Not started', next: 'Build the enablement motion and adoption metrics (active owners, catalog freshness) so a program survives past go-live.' },
  { name: 'On-prem deployment validation', track: 'Track B2', priority: 'P1', state: 'Designed', next: 'Chart lints/templates run in CI; owe a real `helm install` smoke deploy on a cluster.' },
  { name: 'Managed / HA Postgres', track: 'Track B1', priority: 'P1', state: 'In progress', next: 'Replace the bundled single-replica StatefulSet (#26).' },
  { name: 'Audit export / compliance reports', track: 'Governance', priority: 'P1', state: 'Partial', next: 'Audit log is queryable; build SOX/GDPR/HIPAA templates.' },
  { name: 'DQ profiling / column-level auto-stats', track: 'Data quality', priority: 'P1', state: 'Partial', next: 'Row count + freshness only; add null%/distinct/min-max/histograms.' },
  { name: 'Business Capability level above Data Domain', track: 'Track D1', priority: 'P1', state: 'Not started', next: 'Add the top rung of the data hierarchy.' },
  { name: 'Data-model versioning for domains & assets', track: 'Track D3', priority: 'P1', state: 'Partial', next: 'Extend the process-node snapshot pattern to domains and assets.' },
  { name: 'Source-scope → domain auto-mapping', track: 'Track D4', priority: 'P1', state: 'Not started', next: 'Auto-map a connector’s scan scope to the domains it feeds.' },
  { name: 'Unified roleAssignments data model', track: 'Roles', priority: 'P1', state: 'Not started', next: 'Unify role ownership scattered across FKs for cross-role queries + expiry (#26, migration-heavy).' },
  { name: 'WhereUsed on Activity & Person detail', track: 'Cross-layer', priority: 'P1', state: 'Not started', next: 'Exists on System/Data-Asset; extend for full cross-layer coverage (#15).' },
  { name: 'Saved views: column-visibility integration', track: 'Platform', priority: 'P1', state: 'Not started', next: 'Column visibility persists separately; consolidate (#18).' },
  { name: 'PDF export from the Export menu', track: 'Platform', priority: 'P1', state: 'Not started', next: 'Use jspdf or server-side Puppeteer (#11).' },
  { name: 'Comments: email notifications for @mentions', track: 'Collaboration', priority: 'P1', state: 'Not started', next: 'In-app only; needs SMTP + unsubscribe (#13).' },
  { name: 'Governance approval workflows (BPMN-style)', track: 'Governance', priority: 'P2', state: 'Partial', next: 'Task lifecycle state machine ships; add multi-stage approver routing (Camunda/Temporal).' },
  { name: 'Anomaly detection on DQ (ML)', track: 'Data quality', priority: 'P2', state: 'Not started', next: 'Statistical drift/outlier detection.' },
  { name: 'Replace setInterval scheduler with a job queue', track: 'Platform', priority: 'P2', state: 'Not started', next: 'BullMQ / EventBridge so restarts don’t reset cadence (#4).' },
  { name: 'Additional auto-lineage connectors', track: 'Lineage', priority: 'P2', state: 'Not started', next: 'Extend the Snowflake parse→reconcile pipeline to Databricks/BigQuery (#23).' },
  { name: 'BI-tool integration', track: 'Integrations', priority: 'P2', state: 'Not started', next: 'Tableau / Power BI / Looker.' },
  { name: 'Data-product marketplace / catalog', track: 'Platform', priority: 'P2', state: 'Not started', next: 'New data-product entity + access workflow.' },
  { name: 'OpenAPI spec coverage', track: 'Platform', priority: 'P2', state: 'Partial', next: 'Hand-authored spec covers core entities; extend to all routers.' },
  { name: 'Comments: deeper threading', track: 'Collaboration', priority: 'P2', state: 'Not started', next: 'v1 is one level deep (#12).' },
  { name: 'Terminology reactivity & granularity', track: 'Platform', priority: 'P2', state: 'Not started', next: '4 helper-based pages don’t react (#14); per-term overrides (#20).' },
  { name: 'Activity feed: cursor pagination / per-person feed', track: 'Platform', priority: 'P2', state: 'Not started', next: 'Add cursor pagination and a per-person feed (#16, #17).' },
  { name: 'Saved views: roll out to tree-based pages', track: 'Platform', priority: 'P2', state: 'Not started', next: 'Extend saved views to tree-based pages (#19).' },
  { name: 'Accessibility polish', track: 'Platform', priority: 'P2', state: 'Not started', next: 'Heading hierarchy (#21), skip-to-content in modals (#22), manual high-contrast toggle (#25).' },
  { name: 'Roles: scope-aware “held by” + enrichment', track: 'Roles', priority: 'P2', state: 'Not started', next: 'Add scope-aware held-by and server-side enrichment (#27, #28).' },
  { name: 'dbt Cloud: one-click pause toggle', track: 'Lineage', priority: 'P2', state: 'Not started', next: 'Add a one-click pause toggle (#5).' },
  { name: 'System integration graph visualization', track: 'Systems', priority: 'P2', state: 'Not started', next: 'Directed edges exist as lists; add a force-directed graph.' },
];

export interface ChecklistItem { n: string; text: string; pilot: boolean; state: 'Done' | 'Partial' | 'Open'; }
export interface ChecklistGroup { name: string; items: ChecklistItem[]; }
export const ROADMAP_CHECKLIST: ChecklistGroup[] = [
  { name: 'Infrastructure', items: [
    { n: '1', text: 'Postgres up — run deploy/terraform or self-host Postgres 16+; set a real DATABASE_URL', pilot: true, state: 'Open' },
    { n: '2', text: 'Apply migrations — npx prisma migrate deploy', pilot: true, state: 'Open' },
    { n: '3', text: 'JSON → Postgres data migration', pilot: false, state: 'Done' },
    { n: '4', text: 'Cross-file consumers read repositories', pilot: true, state: 'Done' },
    { n: '5', text: 'Auth cutover — SCIM, auth routes, lockout, refresh tokens, MFA/WebAuthn repo-backed', pilot: false, state: 'Done' },
  ] },
  { name: 'Environment / secrets', items: [
    { n: '6', text: 'ANTHROPIC_API_KEY', pilot: true, state: 'Open' },
    { n: '7', text: 'JWT_PRIVATE_KEY + JWT_PUBLIC_KEY (RS256)', pilot: true, state: 'Open' },
    { n: '8', text: 'REDIS_URL (real Redis for rate-limiting/sessions)', pilot: false, state: 'Open' },
    { n: '9', text: 'SMTP_* (mail for notifications/reset)', pilot: true, state: 'Open' },
    { n: '10', text: 'Identity provider config — AUTH_PROVIDER + OIDC/SAML config', pilot: true, state: 'Open' },
    { n: '11', text: 'KMS_PROVIDER / MFA_ENCRYPTION_KEY — encryption at rest', pilot: false, state: 'Open' },
  ] },
  { name: 'Runtime / operations', items: [
    { n: '12', text: 'HTTPS termination at ALB/Nginx (ACM or Let’s Encrypt)', pilot: true, state: 'Open' },
    { n: '13', text: 'Backups (RDS automated + PITR, or .procela-data on JSON)', pilot: true, state: 'Open' },
    { n: '14', text: 'Log aggregation (CloudWatch/Datadog)', pilot: false, state: 'Open' },
    { n: '15', text: 'Uptime monitoring — poll /api/v1/health', pilot: true, state: 'Open' },
    { n: '16', text: 'Rate limits — AI_MAX_CALLS_PER_ORG_PER_HOUR/_DAY', pilot: false, state: 'Open' },
  ] },
  { name: 'Product / content', items: [
    { n: '17', text: 'Real customer data seeded (CSV import or on-prem connector)', pilot: false, state: 'Open' },
    { n: '18', text: 'Legal: ToS, privacy policy, DPA (text is placeholder)', pilot: false, state: 'Open' },
    { n: '19', text: 'Support flow — in-app Report a problem → /api/v1/support', pilot: false, state: 'Done' },
    { n: '20', text: 'Billing — no subsystem exists; integrate Stripe/etc. if SaaS', pilot: false, state: 'Open' },
  ] },
  { name: 'Testing / hardening beyond CI', items: [
    { n: '21', text: 'Load test — harness built; capture a Postgres-backed baseline + tighten budgets', pilot: false, state: 'Partial' },
    { n: '22', text: 'Security review — dep audit + SAST + in-house review done; external pen test remaining', pilot: true, state: 'Partial' },
    { n: '23', text: 'DR runbook — written; owe one staging restore rehearsal', pilot: true, state: 'Done' },
    { n: '24', text: 'Real Postgres integration test in CI', pilot: false, state: 'Done' },
  ] },
  { name: 'Roadmap items still ahead of go-live', items: [
    { n: '25', text: 'Phase 3 connectors — on-prem agent shipped; run against real customer DBs remaining (=A1)', pilot: false, state: 'Partial' },
    { n: '26', text: 'On-prem deployment — Helm chart + CI lint done; smoke deploy + managed/HA Postgres remaining', pilot: false, state: 'Partial' },
    { n: '27', text: 'Rule-8 handlers follow-up', pilot: false, state: 'Done' },
  ] },
];
