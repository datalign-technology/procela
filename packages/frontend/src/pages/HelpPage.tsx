const sectionStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 24,
  marginBottom: 20,
  boxShadow: 'var(--shadow-sm)',
};

const h2Style: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  marginBottom: 12,
  color: 'var(--color-primary)',
  // Keep the heading clear of the 56px sticky app header when an
  // anchor link from the table of contents jumps to it.
  scrollMarginTop: 72,
};

// Section anchors for the in-page table of contents. id values are
// referenced both by the ToC links and the section <h2> elements.
const HELP_SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'help-getting-started', label: '1. Getting Started' },
  { id: 'help-navigation', label: '2. Navigation' },
  { id: 'help-dashboard', label: '3. Dashboard' },
  { id: 'help-processes', label: '4. Processes' },
  { id: 'help-data', label: '5. Data' },
  { id: 'help-systems', label: '6. Systems' },
  { id: 'help-organizations', label: '7. Organizations' },
  { id: 'help-governance', label: '8. Governance' },
  { id: 'help-cross-cutting', label: '9. Cross-cutting Features' },
  { id: 'help-key-concepts', label: '10. Key Concepts' },
  { id: 'help-faq', label: '11. Frequently Asked Questions' },
  { id: 'help-shortcuts', label: '12. Keyboard shortcuts' },
];

const h3Style: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  marginBottom: 8,
  marginTop: 16,
};

const pStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.7,
  color: 'var(--color-text-secondary)',
  marginBottom: 8,
};

const listStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.8,
  color: 'var(--color-text-secondary)',
  paddingLeft: 20,
  listStyle: 'disc',
  marginBottom: 8,
};

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 6px',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 11,
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  color: 'var(--color-text)',
};

export default function HelpPage() {
  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 8 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Help Guide</h1>
        <button
          onClick={() => window.dispatchEvent(new Event('procela:start-tour'))}
          style={{
            padding: '8px 16px', background: 'var(--color-surface)',
            color: 'var(--color-primary)', border: '1px solid var(--color-primary)',
            borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            flexShrink: 0,
          }}
          title="Show the three-phase Define / Connect / Discover intro again"
        >
          Replay intro
        </button>
      </div>
      <p style={{ ...pStyle, marginBottom: 16 }}>
        Procela is a DAMA-aligned governance operating platform that helps organizations design, execute, and mature
        data governance using workflows, accountability models, and structured procedures.
      </p>

      {/* On this page — anchor links so a user can jump straight to a
          section instead of scrolling a 12-section wall of text. */}
      <nav aria-label="Help contents" style={{ ...sectionStyle, marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 10 }}>
          On this page
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 16px' }}>
          {HELP_SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              style={{ fontSize: 13, color: 'var(--color-primary)', textDecoration: 'none', padding: '2px 0' }}
            >
              {s.label}
            </a>
          ))}
        </div>
      </nav>

      {/* 1. Getting Started */}
      <div style={sectionStyle}>
        <h2 id="help-getting-started" style={h2Style}>1. Getting Started</h2>
        <ol style={{ ...listStyle, listStyle: 'decimal' }}>
          <li>Sign in using dev mode or your enterprise SSO credentials</li>
          <li>Go to <strong>Organizations &rarr; Structure</strong> to create your company / division / team tree</li>
          <li>Go to <strong>Organizations &rarr; People</strong> to add team members and assign roles</li>
          <li>Go to <strong>Governance &rarr; Program</strong> to begin the 4-phase governance setup journey</li>
          <li>Follow the phase recommendations to build your governance foundation</li>
        </ol>
        <h3 style={h3Style}>The 4-Phase Governance Journey</h3>
        <ul style={listStyle}>
          <li><strong>Phase 1 &mdash; Foundation:</strong> Define governance scope, guiding principles, and operating model</li>
          <li><strong>Phase 2 &mdash; Structural Design:</strong> Create data domains, governance groups, and assign roles</li>
          <li><strong>Phase 3 &mdash; People &amp; Processes:</strong> Assign stewards, build RACI matrix, create policies</li>
          <li><strong>Phase 4 &mdash; Operationalization:</strong> Define SOPs, set up calendar, launch the program</li>
        </ul>
      </div>

      {/* 2. Navigation */}
      <div style={sectionStyle}>
        <h2 id="help-navigation" style={h2Style}>2. Navigation</h2>
        <p style={pStyle}>The sidebar opens with the platform's "who" and "what does work" before fanning out into the artefact buckets. Dashboard is a direct link; Organizations and Processes follow as the actors and the verb that connects them; Data / Systems / Governance / Insights cover the artefacts the work runs through. Sections with multiple destinations are accordions you can expand and collapse.</p>
        <ul style={listStyle}>
          <li><strong>Dashboard</strong> &mdash; Personalized home with your tasks, issues, domains, and KPIs.</li>
          <li><strong>Organizations</strong> &mdash; Accordion covering the "who" of the platform: <strong>Structure</strong> (your company / division / team tree), <strong>People</strong> (the humans on your team), <strong>Agents</strong> (AI agents that hold governance roles and run automation), and <strong>Skills</strong> (the competencies your roles need).</li>
          <li><strong>Processes</strong> &mdash; the Process Catalog, where you define value streams, processes, sub-processes and activities, and connect each node to its owner / responsible role / systems / data assets inline. Direct link, not an accordion. (The cross-process flat-list view of activity↔asset mappings lives under <strong>Insights &rarr; Process Coverage</strong>.)</li>
          <li><strong>Data</strong> &mdash; Data Assets, Glossary, Data Dictionary, Lineage, Domains, Data Quality.</li>
          <li><strong>Systems</strong> &mdash; Systems and Connections (databases, APIs, files).</li>
          <li><strong>Governance</strong> &mdash; grouped into <strong>Set up</strong> (Program, Groups, Roles with RACI Matrix tab, Policies, Decision Rights) and <strong>Operate</strong> (Documentation with Manual + Procedures tabs, Calendar, Tasks &amp; Issues). The sub-labels are visual dividers in the expanded section &mdash; every item still navigates directly.</li>
          <li><strong>Insights</strong> &mdash; Enterprise View, Analysis, Reports, Process Coverage. Cross-cutting exploration surfaces that read across Data, Systems, People, Processes and Governance &mdash; promoted out of Governance so they're easier to find.</li>
        </ul>
        <p style={pStyle}>Settings and Help sit at the bottom of the sidebar.</p>

        <h3 style={h3Style}>Header controls</h3>
        <ul style={listStyle}>
          <li><strong>Search box (Cmd/Ctrl + K or /)</strong> &mdash; Universal command palette. Searches processes, data assets, systems, people, domains, and groups in your active org. Results are ranked and link directly to the matching item.</li>
          <li><strong>Working in &hellip;</strong> &mdash; Organization selector. Scopes every page to the selected org. Divisions are listed nested under their parent company (Tidewater Utilities ▸ Electric / Water), so you can drop into a division-scoped view without leaving the page. Single-tier companies render as a flat list.</li>
          <li><strong>Plain / DAMA toggle</strong> &mdash; Flips jargon-heavy labels (Custodian &harr; Operator, Governance Tier &harr; Trust Level, Uncertified/Managed/Certified &harr; Untrusted/Managed/Trusted). Plain is the default; preference persists in your browser.</li>
          <li><strong>Cozy / Compact toggle</strong> &mdash; Row density. Compact halves vertical padding for power-user table scanning. Persists in your browser.</li>
        </ul>
      </div>

      {/* 3. Dashboard */}
      <div style={sectionStyle}>
        <h2 id="help-dashboard" style={h2Style}>3. Dashboard</h2>
        <p style={pStyle}>The dashboard is personalized to your login. You must have a People record with your email to see personalized data.</p>
        <ul style={listStyle}>
          <li><strong>My Dashboard</strong> &mdash; Open tasks, issues, domains you own/steward, upcoming events</li>
          <li><strong>Needs My Attention</strong> &mdash; Overdue tasks, critical issues, pending policy reviews</li>
          <li><strong>My Schedule</strong> &mdash; Governance events in the next 14 days</li>
          <li><strong>Overview</strong> &mdash; Organization-wide KPIs (value streams, assets, coverage, health)</li>
          <li><strong>Program Maturity</strong> &mdash; Current governance phase with next steps to advance</li>
          <li><strong>What&apos;s Next</strong> &mdash; Contextual recommendations based on org maturity</li>
          <li><strong>Recent Activity</strong> &mdash; Last audit log entries (expandable)</li>
          <li><strong>Quick Actions</strong> &mdash; Shortcuts to common tasks</li>
        </ul>
        <p style={pStyle}>Click <strong>Customize</strong> to reorder or hide dashboard sections. Layout is saved automatically.</p>
      </div>

      {/* 4. Processes */}
      <div style={sectionStyle}>
        <h2 id="help-processes" style={h2Style}>4. Processes</h2>
        <h3 style={h3Style}>Process Catalog</h3>
        <ul style={listStyle}>
          <li>Hierarchical process catalog: Value Stream &rarr; Process &rarr; Activity (with optional Sub-Process and Task levels for detail).</li>
          <li>AI-powered Value Stream Wizard generates industry-specific process hierarchies; one-click clone across divisions. The wizard's output is <strong>cached per industry</strong> on the server, so the first user to pick "Utilities" pays the 10–30 second Claude call and every subsequent run for the same industry returns the same template instantly. A <em>Cached</em> / <em>Fresh from AI</em> badge on the review screen tells you which version you're looking at; a <em>Regenerate from AI</em> button next to the standard <em>Regenerate</em> bypasses the cache and replaces the stored copy with a brand-new Claude generation.</li>
          <li>Level-specific attributes: frequency, risk level, responsible role, automation level.</li>
          <li>Status lifecycle: Draft &rarr; Active &rarr; Deprecated.</li>
          <li><strong>Operational / Governance lens.</strong> A segmented control (<em>All · Operational · Governance</em>) at the top filters which value streams show. Governance value streams (created by the governance template) carry a persisted domain classifier; business value streams are operational. The lens is <strong>per page</strong> — the Process Catalog always opens on <strong>All</strong>, and your choice here is independent of the lens on other pages (so it can't reset what you picked on Data Assets).</li>
          <li>Assigning an Owner or Stakeholders opens the shared <strong>person picker</strong> &mdash; search by name / title / org, or browse the org tree (Company &rarr; Division &rarr; Department) or governance groups. Every result shows the person's title and org path so two people with the same name are distinguishable. The same picker is used for owners, stewards, deputies, and group members across the app.</li>
          <li><strong>Domain-aware role assignment.</strong> Governance value streams default the person picker to the governance bodies and the <strong>Responsible Role</strong> selector to the DAMA governance roles only; operational (business) processes default to the org tree and the generic business roles, with the DAMA roles hidden. A "show all roles" toggle reveals the other set for genuine cross-overs, and a picked role from the other domain is flagged <em>Cross-domain</em>. Existing free-text role values are preserved until you re-pick.</li>
          <li><strong>Cross-division link warning.</strong> When you add a data-asset link to an activity inside the Inputs / Outputs panel, Procela checks whether the asset's owner org is on the same vertical axis as the activity's value-stream org (i.e. same org, ancestor, or descendant). If it isn't — typically a Tidewater Water activity reaching for a Tidewater Electric asset — a confirm pops first: <em>"&lt;Asset&gt; is owned by &lt;Other Division&gt;, but &lt;Activity&gt; sits in &lt;This Division&gt;. Cross-division links usually mean the wrong asset was picked — pick again, or confirm if this is genuinely a shared dependency."</em> The default is <strong>warn, not block</strong>: confirming creates the link normally; cancelling drops it. Cross-axis links to shared parent-company assets (a Water activity using the corporate Customer Master) go through silently because the asset is in scope by inheritance.</li>
          <li><strong>Where value streams can be created.</strong> Streams attach to the active org in the <em>Working in&hellip;</em> header, but only at the <strong>company</strong> or <strong>division</strong> level. Two cases block the create UI (the <em>+ Add value stream</em> button, the wizard wand, the governance-template wand, and the empty-state buttons all hide; Visualize / Compare / Export stay available):
            <ul style={{ ...listStyle, marginTop: 6, marginBottom: 6 }}>
              <li><strong>Wrong level.</strong> The active org is a department, team, or anything below division. Pick a parent org from <em>Working in&hellip;</em>.</li>
              <li><strong>Multi-division company.</strong> The active org is a company that has at least one division anywhere in its subtree (e.g. Tidewater Utilities → Electric / Water, or Company → Region → Division). Generating at the parent would silently create one shared <em>operational</em> catalog the divisions don't actually share. The banner lists the divisions as one-click <em>Switch to:</em> chips, so you can drop into one without leaving the page. Single-tier companies (no divisions) keep working normally at the company level. <strong>Governance is the exception</strong> — corporate data governance is intentionally one enterprise-wide program (one policy book, one decision-rights matrix, one RACI), so the <em>Generate governance processes</em> wand stays available at the parent and isn't blocked even when divisions exist.</li>
            </ul>
            The same guard applies to both the Process Wizard and the catalog's manual create path so it can't be sidestepped.
          </li>
        </ul>
        <h3 style={h3Style}>Process Coverage</h3>
        <ul style={listStyle}>
          <li>Flat audit / bulk-edit view of every activity ↔ data-asset link in the catalog. Sortable columns, CSV/Excel export, bulk delete, and the Batch Mapping Wizard (matrix interface) for creating many mappings at once.</li>
          <li>Day-to-day, you connect an activity to its data assets <strong>inline on the Process Catalog</strong> — each node panel has Owner, Responsible Role, Systems, and Inputs/Outputs (data assets) in one place. Process Coverage is the cross-process review surface for those same links; it doesn't introduce a separate model.</li>
          <li>Mappings can be AI-suggested or user-defined; the page tracks which is which so suggestion overrides are auditable.</li>
        </ul>
      </div>

      {/* 5. Data */}
      <div style={sectionStyle}>
        <h2 id="help-data" style={h2Style}>5. Data</h2>
        <h3 style={h3Style}>Data Assets</h3>
        <ul style={listStyle}>
          <li>Register data assets in business terms. Each asset has a Trust Level (Untrusted / Managed / Trusted &mdash; DAMA mode calls these Uncertified / Managed / Certified).</li>
          <li>Sidebar filter by data type: Operational, Governance, Reference, Analytical, Master.</li>
          <li>Inline editing for Trust Level and health score directly in the table.</li>
          <li><strong>Link to Source</strong> connects an asset to a database table, file, or API in the add/edit form.</li>
          <li>Expandable columns show data types and quality rules per column.</li>
          <li>Bulk set Trust Level / owner / steward.</li>
          <li><strong>Where Used</strong> in the detail modal shows every process, mapping, and policy referencing the asset.</li>
          <li><strong>Operational / Governance lens.</strong> The same <em>All · Operational · Governance</em> control used on the Process Catalog. Governance-template placeholder assets are classified governance; everything else is operational. The lens is <strong>per page</strong> and persisted — Data Assets remembers your choice independently of other pages.</li>
          <li><strong>Org scope and inheritance.</strong> Each asset is owned by exactly one org, and only <strong>company</strong> or <strong>division</strong> levels can own — departments and teams can't. If the active <em>Working in&hellip;</em> scope isn't an owning level, the <em>+ Add data asset</em> button is hidden and a banner explains why (the list still renders so users can read inherited rows from above). When you're scoped to a division, the list shows division-owned assets <em>plus</em> assets owned at the parent company — the parent-owned ones carry a small <em>Owned by &lt;Company&gt;</em> badge and their edit / delete / inline-cell affordances are disabled with a "Switch the Working in&hellip; scope to &lt;Company&gt; to edit" tooltip. Conversely, a company-scoped user sees everything below (a rollup view) with the same badge on division-owned rows. Sibling divisions don't see each other's assets. The level guard is enforced server-side too — a direct API call with a department-level <code>orgId</code> is rejected with a 400.</li>
        </ul>
        <h3 style={h3Style}>Business Glossary</h3>
        <ul style={listStyle}>
          <li>Searchable dictionary of agreed-upon business terms.</li>
          <li>Group by category (Business, Technical, Regulatory, Metric) or alphabetically.</li>
          <li>Industry-specific seed terms based on your organization's industry.</li>
          <li>Approval workflow: Draft &rarr; Proposed &rarr; Approved &rarr; Deprecated.</li>
        </ul>
        <h3 style={h3Style}>Data Dictionary</h3>
        <ul style={listStyle}>
          <li>Publishable technical catalog of all data assets organized by domain.</li>
          <li>Shows columns, data types, ownership, source connections, health scores.</li>
          <li>Export to CSV, Excel, JSON, or clipboard via the Export button.</li>
        </ul>
        <h3 style={h3Style}>Data Lineage</h3>
        <ul style={listStyle}>
          <li>Upstream / downstream data flow visualisation. Visualization view has a three-way toggle: <strong>Systems</strong> (system-to-system flows), <strong>Assets</strong> (auto-derived asset-to-asset edges), or <strong>Both</strong>.</li>
          <li><strong>Import dbt manifest</strong> &mdash; drop a dbt-generated <code>manifest.json</code>. Procela creates or matches a Data Asset for each model, source, seed, and snapshot, then derives asset-to-asset edges from <code>depends_on</code>. dbt tests in the manifest become Data Quality rules automatically (not_null &rarr; Completeness/NOT_NULL, unique &rarr; Uniqueness/UNIQUE, accepted_values &rarr; Validity/IN_SET, relationships &rarr; Consistency/CUSTOM).</li>
          <li><strong>dbt Cloud connections</strong> &mdash; configure account ID, job ID, and API token. Procela pulls the manifest for the latest successful run, on a polling schedule of your choice (Hourly / Daily / Weekly) or on demand via <em>Refresh now</em>. Last refresh time, status, and a relative "next in 4h" hint show in the table.</li>
          <li><strong>Stale-edge detection</strong> &mdash; auto-derived edges that haven't been re-seen by an import in 30 days are flagged with a STALE badge in the table and rendered as dashed lines in the visualisation. Manual edges are exempt.</li>
          <li>Re-imports are idempotent &mdash; assets, edges, and dbt-test rules are matched by stable identifiers and updated in place. Edges and rules removed from the manifest are deleted; user edits to a dbt-derived rule survive the next refresh.</li>
        </ul>
        <h3 style={h3Style}>Data Domains</h3>
        <ul style={listStyle}>
          <li>Logical groupings of data assets (e.g., Customer Data, Financial Data).</li>
          <li>Assign owner and stewards per domain.</li>
          <li>Option to auto-create a Data Stewardship Team when creating a domain.</li>
          <li>AI-generated domain suggestions based on your industry.</li>
        </ul>
        <h3 style={h3Style}>Data Quality</h3>
        <ul style={listStyle}>
          <li>Quality rules per asset / column with dimensions (completeness, accuracy, timeliness, etc.).</li>
          <li>Weighted scoring rolls up to an asset-level health score.</li>
          <li>dbt tests imported via a manifest become rules automatically (templateId starts with <code>dbt:</code>). Edits to those rules persist across re-imports; removed tests delete their rule.</li>
        </ul>
      </div>

      {/* 6. Systems */}
      <div style={sectionStyle}>
        <h2 id="help-systems" style={h2Style}>6. Systems</h2>
        <h3 style={h3Style}>Systems</h3>
        <ul style={listStyle}>
          <li>Register applications and platforms. Sidebar filter by type (ERP, CRM, GIS, etc.).</li>
          <li>Business criticality rating (High / Medium / Low) with filter.</li>
          <li>Clicking a system name opens the detail modal; inline editing is reserved for the Type column. Rename via the row's Edit pencil.</li>
          <li>Owner, Deputy Owner, and Operators (DAMA: Custodians) per system &mdash; the people on the hook day-to-day. Clicking any of those role badges opens the Role Detail drawer for that entity-attached role, so users see the same definition / responsibilities / required-skills view as for DAMA roles.</li>
          <li>Where Used panel shows every data asset, connection, and process touching the system. A Discussion (comments) and Activity section sit at the bottom of the modal.</li>
          <li><strong>Org scope and inheritance.</strong> Same rule as Data Assets — each system is owned by exactly one org (company or division), departments and teams can't own. The <em>+ Add system</em> button hides when the active scope is a non-owning level; rows whose owner doesn't match the active <em>Working in&hellip;</em> scope carry an <em>Owned by &lt;Org&gt;</em> badge and have their edit / delete affordances disabled with a switch-scope tooltip. The level guard is enforced server-side.</li>
        </ul>
        <h3 style={h3Style}>Connections</h3>
        <ul style={listStyle}>
          <li>Database, File Storage, API, Data Warehouse, and Spreadsheet connections.</li>
          <li>Test connection (TCP / HTTP probe) and Discover (list assets reachable through the connection).</li>
          <li>Many-to-many: a connection can serve multiple systems.</li>
        </ul>
      </div>

      {/* 7. Organizations */}
      <div style={sectionStyle}>
        <h2 id="help-organizations" style={h2Style}>7. Organizations</h2>
        <p style={pStyle}>
          The "who" of the platform. The Organizations accordion gathers the four things that act on (or are acted on by) your data: the company tree itself, the humans, the AI agents, and the competencies those actors carry.
        </p>
        <h3 style={h3Style}>Structure</h3>
        <ul style={listStyle}>
          <li>Hierarchical company tree (company &rarr; division &rarr; department &rarr; team) that scopes every other page.</li>
          <li>Import from CSV / JSON, tree visualization, "Working in" selector in the header picks the active branch.</li>
          <li>The sidebar label is <em>Structure</em> but the page route is still <code>/organizations</code> and the browser tab reads "Organizations · Procela".</li>
          <li><strong>Deleting an org is a controlled blast.</strong> Clicking delete opens a dedicated dialog (not a generic confirm) that walks you through what cascades. The dialog opens with a red "This action cannot be undone" banner and a severity badge — <em>Small / Medium / Large / Catastrophic</em> — computed from the total entity count and number of child orgs. Every affected category (people, processes, data assets, systems, mappings, governance documents, controls, etc.) is listed with both the count and up to three sample names ("47 mappings — Bills→Customer Master, Outages→SCADA, +44 more") so you can see exactly what you're about to delete, not just a number. Each category gets a per-category action picker (<em>Delete</em> / <em>Move to…</em> / <em>Orphan</em>; orphan is only allowed for People and Processes), a "default for everything" picker that bulk-applies one action, a live tally at the bottom, and a type-<code>DELETE</code> confirmation gate. An <em>Export org snapshot</em> button in the footer downloads a JSON archive of every entity the delete would touch — recommended before any Large or Catastrophic delete as a recovery aid.</li>
        </ul>
        <h3 style={h3Style}>People</h3>
        <ul style={listStyle}>
          <li>Team members with app roles (Super Admin, Org Admin, Editor, Contributor, Viewer).</li>
          <li>Import from CSV. Columns: Name (required), Email, Role, Title, Org (optional). An <em>Org</em> value on a row lands that person in the named org — either a full path (<code>Tidewater Utilities &gt; Tidewater Electric &gt; Power Generation</code>) or a single unique name; rows without the column fall back to the "Default org" picked in the import dialog. The People export emits the same Org column so a single-file enterprise-wide round-trip preserves which org each person belongs to.</li>
          <li>Click any role chip on a person's profile to open the Role Detail drawer.</li>
        </ul>
        <h3 style={h3Style}>Agents</h3>
        <ul style={listStyle}>
          <li>AI agent registry for governance execution &mdash; pipelines, bots, service accounts.</li>
          <li>Agents can hold governance roles too (e.g., an automated DQ agent as Data Quality Analyst), which is why they sit alongside People rather than in a separate "automation" bucket.</li>
        </ul>
        <h3 style={h3Style}>Skills</h3>
        <ul style={listStyle}>
          <li>Catalog of competencies attached to people. Seed standard DAMA-aligned skills with one click.</li>
          <li>The Role Detail drawer reads from this catalog to show "Skills typically needed" for each governance role &mdash; chips appear solid when the skill is in your org's catalog, dashed if not yet seeded.</li>
        </ul>
      </div>

      {/* 8. Governance */}
      <div style={sectionStyle}>
        <h2 id="help-governance" style={h2Style}>8. Governance</h2>
        <h3 style={h3Style}>Governance Program</h3>
        <ul style={listStyle}>
          <li>4-phase setup journey with progress tracking per phase. The phase you're currently on is highlighted with a <strong>“YOU ARE HERE”</strong> marker and a larger title, so "phase N of 4" is obvious at a glance; completed phases show a check and finished ones dim back.</li>
          <li>Define governance scope (what's in / out), guiding principles, operating model.</li>
          <li>Phase completion is computed automatically from your actual data; next-action recommendations link to the right page.</li>
          <li><strong>Governed lifecycle:</strong> the program status (Planning &rarr; Active &harr; Paused &rarr; Completed, with explicit Reopen) can only be changed by an admin / program owner, follows a fixed transition path (no backward slides or skips), and every change is written to the audit log with the actor and an optional reason. Phase 1 (Foundation) must be complete before the program can go Active; launching with Phases 2&ndash;4 incomplete pops a confirmation listing exactly what's missing and records it as an early launch.</li>
        </ul>
        <h3 style={h3Style}>Governance Groups</h3>
        <ul style={listStyle}>
          <li>Hierarchical governance bodies: Council &rarr; Office &rarr; Committee &rarr; Stewardship Teams &rarr; Working Groups &rarr; Communities of Practice.</li>
          <li>Generate the standard DAMA structure with one click. Explore Recommendations suggests additional groups based on your data domains.</li>
          <li>Per group: an Expected Roles panel lists the governance roles the group should have, the required vs optional split, and current fill status. Click any role label to open the Role Detail drawer.</li>
          <li><strong>Org-aware fill status.</strong> A role counts as filled when it's held anywhere in the org — the same scope the Governance Roles page assigns at — not only by a current member of this group. Each holder chip shows their relationship to this body: teal = on the group, amber = holds the role org-wide but isn't a member yet, with an inline <strong>+ add to group</strong> to bring them on. So a role assigned on the Roles page is recognised here, and assigning here writes the same org-scoped assignment — the two pages stay consistent in both directions.</li>
          <li>Two remove actions are distinct: the <strong>x on a role chip</strong> removes that specific role assignment; <strong>Remove from group</strong> in the members table removes the person from the group entirely (their role assignments survive at the org level).</li>
          <li><strong>Open full composition →</strong> on any selected group jumps to the Group Composition page (<code>/governance-groups/:id</code>) &mdash; one cohesive surface that combines members, expected-role gaps, decision rights this body owns, policies tied to it via member roles, the calendar cadence, and a snapshot of RACI assignments. Each role chip shows the typical RACI letter(s) the role holds on common decisions, so you can see at a glance what each role is accountable / responsible / consulted / informed for without opening the drawer.</li>
          <li><strong>Group role vs governance role.</strong> These are two independent things and the members table calls it out: a person's <em>group role</em> (Chair, Member, Secretary…) is just their seat on this body and has no RACI effect; their <em>governance roles</em> (Data Owner, Steward, CDO…) are the org-wide DAMA roles that drive RACI and ownership. Someone can be a group Member with no governance role, or hold a governance role without sitting on any group.</li>
        </ul>
        <h3 style={h3Style}>Roles (with RACI Matrix tab)</h3>
        <ul style={listStyle}>
          <li>Single page with two tabs: <strong>Assignments</strong> and <strong>RACI Matrix</strong>. RACI is a view derived from role assignments, so editing and inspection live together.</li>
          <li><strong>Assignments tab.</strong> Role-first catalog of DAMA governance roles (CDO, Data Governance Lead, Data Owner, Stewards, etc.). The left sidebar lists <em>every</em> role with its live holder count &mdash; filled or not &mdash; and clicking one filters the page to that role. The main area always shows the full role slate: filled rows list the holders inline; unfilled rows are flagged with an <em>Unfilled</em> marker and an inline <em>+ Assign</em>. A search box matches role label, person, or organization. This page tells the same story as the Governance Groups expected-role slate &mdash; the roles always exist; assignment is what varies.</li>
          <li>Click any role chip anywhere in the app to open the <strong>Role Detail drawer</strong> &mdash; plain-language summary, day-to-day responsibilities, typical RACI authority, groups that need the role, current assignees in your org, and required skills.</li>
          <li>The drawer also covers <strong>entity-attached roles</strong> &mdash; System Owner, Deputy System Owner, System Custodian, Data Asset Owner / Steward, Data Domain Owner / Steward. The drawer shows a "Per system / asset / domain" scope badge so users understand two people can both hold the same entity-attached role for different entities without it being a RACI violation.</li>
          <li><strong>RACI Matrix tab.</strong> Responsibility assignments per process activity: Responsible, Accountable, Consulted, Informed. Auto-derived from process / asset ownership and governance group membership; click a cell to cycle R &rarr; A &rarr; C &rarr; I &rarr; clear as a manual override. Validation warnings surface RACI rule violations (no R, no A, multiple A's). Export to CSV / Excel / JSON respects active filters and hide-empty-columns setting.</li>
          <li>Old <code>/raci</code> deep links still work &mdash; they redirect to the RACI tab.</li>
        </ul>
        <h3 style={h3Style}>Decision Rights</h3>
        <ul style={listStyle}>
          <li>Document who Decides, Recommends, Approves, and is Informed for each governance decision.</li>
          <li>Sidebar of categories with counts; search box matches decision name, description, decider, or escalation path.</li>
          <li>Rows are collapsible: default view shows decision + category + decider, click a row to reveal the full R / A / C / I and escalation panel.</li>
          <li>10 seed decisions (approve policy, grant exception, close issue, etc.) ship out of the box.</li>
        </ul>
        <h3 style={h3Style}>Governance Documents (was Policies)</h3>
        <ul style={listStyle}>
          <li>The unified home for every formal governance document with a lifecycle — <strong>Charter</strong> (program scope / principles), <strong>Framework</strong> (overarching structure), <strong>Standard</strong> (naming conventions / data type rules), and <strong>Policy</strong> (the rule-shaped subset). A segmented filter at the top of the page lets you focus on one type or see all.</li>
          <li>Each row carries a <em>documentType</em> badge plus the existing status, review cadence, owner, and category. Codes are auto-generated and per-type — <code>CHA-001</code>, <code>FRW-001</code>, <code>STD-001</code>, <code>POL-001</code> — so the code itself tells you what kind of document you're looking at.</li>
          <li><strong>Controls hang off Policies only.</strong> The expanded controls panel only opens for rows with <em>documentType: Policy</em> — charters and frameworks don't have rule-shaped controls and the panel stays hidden for them.</li>
          <li>Controls have a type (Preventive / Detective / Corrective) and an automation mode (Human / Agent / Hybrid).</li>
          <li>This used to be called <em>Policies</em> and was scoped to rules only. The old <code>/governance-policies</code> URL still works as a back-compat alias; the canonical path is <code>/governance-documents</code>. Sidebar label is now <strong>Documents</strong> under the Governance section.</li>
          <li>If you previously ran the <em>Generate governance processes</em> wand, it used to seed 15 "governance Data Assets" — Charter, Policies, Standards, Glossary, Domain Catalog, etc. A one-time startup migration moves the four real documents (Charter, Data Policies, Data Standards, Access Control Policies) into Governance Documents with the right type, and deletes the rest because they were either duplicates of existing entities (Glossary, Domains, Lineage, DQ Rules, Issues, Tasks) or generated outputs (reports, communications) that were never really stored data.</li>
        </ul>
        <h3 style={h3Style}>Documentation (Manual + Procedures)</h3>
        <ul style={listStyle}>
          <li>Single page with two tabs &mdash; the Manual answers "what does each role do?", the Procedures tab answers "how do I do task X?".</li>
          <li><strong>Manual tab.</strong> Role-specific runbooks for the 10 governance roles, with daily / weekly / monthly / quarterly activities and escalation paths.</li>
          <li><strong>Procedures tab.</strong> Step-by-step SOPs for common governance activities. 5 seed SOPs (onboard data asset, quality incident, access request, escalation, quarterly review).</li>
          <li>Old <code>/operations-manual</code> and <code>/sops</code> deep links still work &mdash; they redirect to the right tab.</li>
        </ul>
        <h3 style={h3Style}>Governance Calendar</h3>
        <ul style={listStyle}>
          <li>Recurring events (Council meetings, Committee syncs, stewardship huddles) with cadence options weekly through annual.</li>
          <li>Auto-generates governance tasks per attendee when an event occurs.</li>
        </ul>
        <h3 style={h3Style}>Tasks &amp; Issues</h3>
        <ul style={listStyle}>
          <li><strong>Tasks</strong> &mdash; workflow states (Draft &rarr; Open &rarr; In Progress &rarr; Pending Review &rarr; Completed), priority, assignee, due dates.</li>
          <li><strong>Issues</strong> &mdash; 9 types (Metadata, Data Quality, Classification, Ownership, Policy, Access, Lineage, Compliance, Workflow), severity levels.</li>
          <li>Steward onboarding: auto-creates 4 tasks when a steward role is assigned (7 / 14 / 21 / 90-day milestones).</li>
        </ul>
        <h3 style={h3Style}>Enterprise View</h3>
        <ul style={listStyle}>
          <li>Single pane of glass across processes, systems, data assets, domains, and people. Filters by view preset (Process &rarr; System &rarr; Data, Governance, Ownership, Lineage, etc.) to focus on one relationship at a time.</li>
          <li><strong>Cards / Diagram</strong> toggle &mdash; the diagram lays nodes out as horizontal swimlanes with edges between lanes so you can see how the org is wired together at a glance. Cards is the dense alternative.</li>
          <li>Click any node to run impact analysis &mdash; the sidebar lists every entity connected to your selection (direct and transitive), and unrelated nodes fade out. Use this to plan changes ("if we deprecate System X, which processes are affected?").</li>
          <li><strong>What happened to Control Tower?</strong> The operational dashboard view folded in here. Old <code>/control-tower</code> deep links redirect to Enterprise View. Future updates may add a dedicated "Health" preset that mirrors the old dashboard.</li>
        </ul>
        <h3 style={h3Style}>Analysis (cube)</h3>
        <ul style={listStyle}>
          <li>Drag-and-drop pivot builder. Drag a dimension into <strong>Rows</strong>, another into <strong>Columns</strong>; the grid below shows how many records connect each pair. Seven dimensions ship: Systems, Data Assets, Domains, Processes, Roles, People, Connections. Reachable from the sidebar (<strong>Insights</strong> &rarr; Analysis) and from Dashboard <strong>Quick Actions</strong>.</li>
          <li><strong>Starter pivots.</strong> Before you've configured anything, the empty state offers one-click examples (Data Assets by System, Roles by Person, Assets by Domain, Processes by System) so you can see a result immediately instead of facing a blank palette.</li>
          <li><strong>Sub-group.</strong> Drag a second dimension into either zone to create a nested grouping (max 2 per axis). The grid renders the parent label with a merged cell spanning all its sub-rows / sub-columns, so e.g. <em>Systems &gt; Data Assets</em> on rows shows each system once with its assets indented underneath.</li>
          <li><strong>Pivot.</strong> The ⇄ button between the Rows and Columns zones swaps everything in one click — useful when you want to flip a tall report into a wide one without re-dragging.</li>
          <li><strong>Drill down.</strong> Click any cell count to open a side panel listing the underlying records (asset facts, role assignments, mappings, ownership rows, etc.).</li>
          <li><strong>Filter.</strong> Click any row label or column header to add that value as a filter; chips appear above the grid and can be removed individually. Each filter narrows the cube to facts that match that dim/value.</li>
          <li><strong>Saved reports.</strong> Save your (rows / columns / filters) configuration with a name and description. Reports are org-visible; only the owner can rename or delete their own. The active dims are also mirrored to the URL so direct links are shareable without saving. Saved pivots also appear under <strong>Reports &rarr; Analysis</strong>, so the two report homes stay connected.</li>
          <li><strong>Export.</strong> The full grid exports to CSV, Excel, JSON, or PDF (browser-print) with row/column totals included. Sub-group labels are flattened with “ / ” separators in the export.</li>
        </ul>
        <h3 style={h3Style}>Reports</h3>
        <ul style={listStyle}>
          <li>Tabbed: <strong>Executive Report</strong> (printable / PDF), <strong>Scorecard</strong> (governance health by dimension), and <strong>Analysis</strong> — a read-only list of saved cube pivots with a link straight into the Analysis builder, so saved pivots are discoverable from the Reports home too.</li>
          <li>Gap Detection (unmapped activities, ungoverned assets) is surfaced across domains, assets, and processes.</li>
        </ul>
        <h3 style={h3Style}>Dependency Enforcement</h3>
        <p style={pStyle}>
          Governance pages show prerequisite banners when prior steps haven't been completed.
          For example, the RACI page shows "Create domains and governance groups first" until those exist.
        </p>
      </div>

      {/* 9. Cross-cutting Features */}
      <div style={sectionStyle}>
        <h2 id="help-cross-cutting" style={h2Style}>9. Cross-cutting Features</h2>
        <p style={pStyle}>
          A handful of components show up on every detail page so the patterns stay the same as you move around the app.
        </p>

        <h3 style={h3Style}>Comments &amp; @mentions</h3>
        <ul style={listStyle}>
          <li>Threaded comments on every major detail surface: System, Data Asset, Person, and per-node on the Process Catalog. One level of replies; deeper threading is a known follow-up.</li>
          <li>Typing <code>@</code> in the composer opens a popover of people in the active org. Arrow keys move selection; Enter or Tab inserts the full name; Escape closes. Cmd/Ctrl + Enter submits the comment.</li>
          <li>Each new @mention spawns an in-app notification for that person with a link back to the entity. Email notifications are a future follow-up.</li>
          <li>Authors can edit or delete their own comments; deletes are soft so thread structure stays intact.</li>
          <li>Comment events appear in the Activity feed under the affected entity, with verbs like "commented on" / "edited a comment".</li>
        </ul>

        <h3 style={h3Style}>Activity feed</h3>
        <ul style={listStyle}>
          <li>Same component in three lenses. Org-wide on the Dashboard's Recent Activity widget; per-entity on the System / Data Asset / Process node detail pages; per-person on the People profile.</li>
          <li>Rows phrase events as English ("Eleanor created System SAP Finance &middot; 5m ago") with the actor's name, the action verb, and the affected record. Comments use conversation verbs; CRUD events use create/update/delete.</li>
          <li>Backed by the audit log; comments, role assignments, and dbt imports all flow through it so the timeline is the single source of truth for "what changed and who changed it".</li>
        </ul>

        <h3 style={h3Style}>Saved views</h3>
        <ul style={listStyle}>
          <li>Capture the current sidebar / search / group-by state on a list page under a name, then recall it later. The <strong>Views</strong> button sits in the page header next to Export.</li>
          <li>Eight list pages support saved views: Data Assets, Systems, Connections, Data Dictionary, Decision Rights, Governance Roles, Business Glossary, and People.</li>
          <li>Views are org-visible &mdash; everyone in the org sees views saved by anyone. Only the owner can delete or rename their own.</li>
          <li>Tree-based pages (Organizations, Process Catalog, Governance Groups) don't have saved views because their state isn't a flat filter set.</li>
        </ul>

        <h3 style={h3Style}>Role Detail drawer</h3>
        <ul style={listStyle}>
          <li>Click any role chip or label anywhere in the app to open the side drawer. Works for both DAMA roles (CDO, Data Owner, Stewards) and entity-attached roles (System Owner, Custodian, Asset Owner, Domain Steward).</li>
          <li>Each role has a plain-language summary, day-to-day responsibilities, typical RACI decision authority, governance groups that need it (DAMA only), current assignees in your org, and required skills.</li>
          <li>Required-skill chips render solid when the skill is in your org's Skills catalog and dashed-italic when it isn't yet, with a hover tooltip explaining what's missing.</li>
        </ul>

        <h3 style={h3Style}>Discussion drawer integration</h3>
        <p style={pStyle}>
          The Comments panel and Activity feed live together on every detail surface, with the Role Detail drawer accessible from any role chip. Together they answer "what is this record, what's changed, and who am I talking to about it" without leaving the page.
        </p>
      </div>

      {/* 10. Key Concepts */}
      <div style={sectionStyle}>
        <h2 id="help-key-concepts" style={h2Style}>10. Key Concepts</h2>
        <h3 style={h3Style}>DAMA Framework</h3>
        <p style={pStyle}>
          Procela follows the DAMA (Data Management Association) framework for data governance. The governance
          structure, roles, and processes align with DAMA best practices.
        </p>
        <h3 style={h3Style}>Org scoping and inheritance</h3>
        <p style={pStyle}>
          Every value stream, data asset, and system is owned by exactly one org. Only the <strong>company</strong> and <strong>division</strong> levels can own — departments and teams inherit visibility from above but can't themselves be owners. The org you pick in the <em>Working in&hellip;</em> header decides which artefacts you see and which you can edit, following the same rule everywhere in the app.
        </p>
        <ul style={listStyle}>
          <li><strong>Visibility rolls down, never sideways.</strong> Scoping to <em>Tidewater Water</em> shows Water-owned artefacts plus everything owned at <em>Tidewater Utilities</em> (the parent company). Sibling divisions (Electric, Shared Services) don't show up. Scoping to the parent company shows the full rollup view — Water, Electric, Shared Services and the company-owned artefacts together.</li>
          <li><strong>Editing is local.</strong> A row whose owner doesn't match the active scope renders with an <em>Owned by &lt;Org&gt;</em> badge and its edit / delete / inline-cell affordances are disabled with a <em>Switch the Working in&hellip; scope to &lt;Org&gt; to edit</em> tooltip. The same rule applies whether the row is inherited from above (a Water user seeing a corporate asset) or rolled up from below (a corporate user seeing a Water asset).</li>
          <li><strong>Create flows enforce the rule on both ends.</strong> The <em>+ Add value stream</em>, <em>+ Add data asset</em>, and <em>+ Add system</em> buttons hide when the active scope is a department or team, and the backend rejects a direct API call with a non-owning <code>orgId</code> with a 400. For value streams there's a second guard: generating <em>operational</em> processes at a multi-division company is blocked (with one-click <em>Switch to: &lt;Division&gt;</em> chips in the warning) because each division should own its own process catalog. <em>Governance</em> processes are exempt from that second guard — corporate governance is one enterprise-wide program by design, so the <em>Generate governance processes</em> wand still works at the parent.</li>
          <li><strong>Cross-division links warn before saving.</strong> Linking a Water activity to an Electric asset (sibling divisions, neither an ancestor of the other) pops a confirm — the reference almost always means the wrong asset was picked. Cross-axis links to shared parent-company assets (a Water activity using the corporate Customer Master) go through silently because the asset is in scope by inheritance.</li>
        </ul>
        <h3 style={h3Style}>Plain English vs. DAMA terminology</h3>
        <p style={pStyle}>
          The header has a <strong>Plain / DAMA</strong> toggle that flips jargon-heavy labels between business-friendly and canonical DAMA wording. Plain is the default so business users aren't met with unfamiliar terms; data professionals can switch to DAMA mode for the formal vocabulary.
        </p>
        <ul style={listStyle}>
          <li><strong>Custodian</strong> (DAMA) &harr; <strong>Operator</strong> (Plain)</li>
          <li><strong>Governance Tier</strong> (DAMA) &harr; <strong>Trust Level</strong> (Plain)</li>
          <li><strong>Uncertified / Managed / Certified</strong> &harr; <strong>Untrusted / Managed / Trusted</strong></li>
        </ul>
        <h3 style={h3Style}>Trust Level (Governance Tier)</h3>
        <ul style={listStyle}>
          <li><strong>Untrusted (Uncertified)</strong> &mdash; Catalogued but not yet governed. No formal ownership or quality rules.</li>
          <li><strong>Managed</strong> &mdash; Owner and steward assigned, basic quality rules in place.</li>
          <li><strong>Trusted (Certified)</strong> &mdash; Fully governed, audit-ready data with complete documentation.</li>
        </ul>
        <h3 style={h3Style}>Governance Roles</h3>
        <p style={pStyle}>Click any role chip anywhere in the app to open the Role Detail drawer for a full breakdown of what each role does.</p>
        <ul style={listStyle}>
          <li><strong>Strategic / Executive</strong>: Chief Data Officer (CDO), Data Governance Lead</li>
          <li><strong>Business accountability</strong>: Data Owner, Business Data Steward</li>
          <li><strong>Technical</strong>: Technical Data Steward, Data Architect, Data Engineer, Database Administrator</li>
          <li><strong>Specialty</strong>: Data Quality Analyst, Data Custodian (Operator)</li>
        </ul>
        <h3 style={h3Style}>Automation Modes</h3>
        <ul style={listStyle}>
          <li><strong>Human</strong> &mdash; Task performed entirely by a person.</li>
          <li><strong>Agent</strong> &mdash; Task performed by an AI agent.</li>
          <li><strong>Hybrid</strong> &mdash; Agent recommends, human approves.</li>
        </ul>
        <h3 style={h3Style}>Export formats</h3>
        <p style={pStyle}>
          Every list page has an Export button with format choices: CSV (open in any spreadsheet), Excel (.xlsx with proper types and sheet names), JSON (re-import or feed to the AI assistant), and Copy to clipboard (paste straight into Sheets / Numbers / a doc).
        </p>
      </div>

      {/* 11. FAQ — the keyboard-shortcuts section that used to live
          here was a duplicate of the formatted table further down the
          page. Removed when the L-pass appendix added the better one. */}
      <div style={sectionStyle}>
        <h2 id="help-faq" style={h2Style}>11. Frequently Asked Questions</h2>

        <h3 style={h3Style}>What is Procela?</h3>
        <p style={pStyle}>
          Procela connects your business processes to the data and systems that support them, giving you a single
          place to define how the business works, assign ownership, and govern data quality across every level.
        </p>

        <h3 style={h3Style}>What is the Governance Program page?</h3>
        <p style={pStyle}>
          It guides you through a 4-phase approach to building a governance program: Foundation, Structural Design,
          People &amp; Processes, and Operationalization. Progress is tracked automatically based on your actual data.
        </p>

        <h3 style={h3Style}>How do SOPs work?</h3>
        <p style={pStyle}>
          Open <strong>Governance &rarr; Documentation</strong> and switch to the <em>Procedures</em> tab. Standard Operating Procedures are step-by-step guides for common governance activities. You can seed 5 standard SOPs or create your own. Each step includes a description and estimated time.
        </p>

        <h3 style={h3Style}>Why is "Add value stream" or the Process Wizard hidden?</h3>
        <p style={pStyle}>
          The Process Catalog only lets you create value streams at the <strong>company</strong> or <strong>division</strong> level, and it blocks the parent if the company has divisions in its subtree. The two cases:
        </p>
        <ul style={listStyle}>
          <li><strong>The active org is a department or team.</strong> Pick a parent (company or division) from the <em>Working in&hellip;</em> header.</li>
          <li><strong>The active org is a multi-division company</strong> (e.g. Tidewater Utilities with Electric / Water). Generating <em>operational</em> processes at the parent would silently create one shared catalog the divisions don't actually share. The banner on the page lists the divisions as one-click <em>Switch to:</em> chips, so you can drop into one without going back to the header. The <em>Working in&hellip;</em> dropdown also lists divisions nested under their parent company. The <em>Generate governance processes</em> wand stays available at the parent even when divisions exist — corporate data governance is intentionally one enterprise-wide program, not a per-division thing.</li>
        </ul>
        <p style={pStyle}>
          Read-only surfaces (Visualize, Compare, Export) stay available even when create is blocked. Single-tier companies with no divisions keep working normally at the company level. The same guard applies to the Process Wizard, so navigating to <code>/processes/wizard</code> with a blocked scope shows the same banner there.
        </p>

        <h3 style={h3Style}>Why can't I edit this data asset (or system)?</h3>
        <p style={pStyle}>
          The row carries an <em>Owned by &lt;Org&gt;</em> badge — its owner is a different org from the one you're scoped to. The list shows it because visibility rolls down (corporate assets are visible to every division) and up (the parent rolls up everything below), but edits are local: you can only edit a row from the scope where it's owned. Hover the disabled Edit pencil for a switch-scope tooltip, or use the <em>Working in&hellip;</em> dropdown directly. Sibling divisions never see each other's rows, so if you're scoped to Tidewater Water you'll never see a Tidewater Electric asset at all.
        </p>

        <h3 style={h3Style}>Why am I being warned about a cross-division link?</h3>
        <p style={pStyle}>
          You're linking a process activity to a data asset whose owner org is on a different vertical axis from the activity's value-stream org — typically a Water activity reaching for an Electric asset when both are scoped from the parent company. Cross-division references almost always mean the wrong asset was picked; the warning is your chance to pick again. Confirming the warning creates the link normally (it's a <strong>warn, not block</strong>), so genuine shared dependencies can still be modelled. Same-axis links — a Water activity using the corporate Customer Master at the parent company — don't trigger the warning because the asset is in scope by inheritance.
        </p>

        <h3 style={h3Style}>Where did Control Tower go?</h3>
        <p style={pStyle}>
          Control Tower folded into <strong>Insights &rarr; Enterprise View</strong>. The operational dashboard view &mdash; open issues, active tasks, policy coverage, automation rate, coverage gaps across domains / assets / processes &mdash; is being reworked as a preset there. Old <code>/control-tower</code> deep links redirect automatically.
        </p>

        <h3 style={h3Style}>I used to open Operations Manual or SOPs directly &mdash; do those links still work?</h3>
        <p style={pStyle}>
          Yes. Both surfaces now live under <strong>Governance &rarr; Documentation</strong> as tabs. Old <code>/operations-manual</code> and <code>/sops</code> bookmarks redirect to the right tab, and shareable links use a <code>?tab=</code> query param so you can deep-link to a tab.
        </p>

        <h3 style={h3Style}>How do I open the RACI Matrix?</h3>
        <p style={pStyle}>
          Open <strong>Governance &rarr; Roles</strong> and switch to the <em>RACI Matrix</em> tab. RACI is a derived view of role assignments, so editing assignments and inspecting RACI now sit together. Old <code>/raci</code> links redirect to the matrix tab.
        </p>

        <h3 style={h3Style}>How do I publish a Data Dictionary?</h3>
        <p style={pStyle}>
          Go to Data &rarr; Data Dictionary. Filter by domain, classification, or trust level if needed, then click the Export button and choose Excel, CSV, JSON, or copy to clipboard.
        </p>

        <h3 style={h3Style}>How do I learn what a governance role does?</h3>
        <p style={pStyle}>
          Click any role chip or label anywhere in the app &mdash; on Governance Groups, on the Governance Roles page, on a person's profile. A side drawer opens with the role's plain-language summary, day-to-day responsibilities, typical RACI decision authority, the governance groups that need it, who currently holds it in your org, and the skills typically needed.
        </p>

        <h3 style={h3Style}>How do I switch between plain English and DAMA terminology?</h3>
        <p style={pStyle}>
          Use the Plain / DAMA toggle in the header next to the density toggle. Plain is the default; the choice persists in your browser. It flips labels like Custodian / Operator, Governance Tier / Trust Level, and Uncertified / Untrusted across the app.
        </p>

        <h3 style={h3Style}>Why are there two ways to remove someone from a governance group?</h3>
        <p style={pStyle}>
          The <strong>x</strong> next to a role chip removes one role assignment (the person stays in the group). <strong>Remove from group</strong> in the members table is the destructive option &mdash; the person leaves the group entirely, but their governance role assignments at the org level survive.
        </p>

        <h3 style={h3Style}>How do I automate lineage from dbt?</h3>
        <p style={pStyle}>
          Go to Data &rarr; Data Lineage &rarr; <strong>+ Connect a dbt Cloud job</strong>. Fill in your dbt Cloud account ID, job ID, and an API token. Set the polling schedule to Hourly / Daily / Weekly (or leave Manual). Procela pulls the manifest from the latest successful run of that job and reconciles models, edges, and dbt tests into the catalog. The same flow works as a one-off via <strong>Import dbt manifest</strong> if you'd rather upload <code>manifest.json</code> by hand from dbt Core.
        </p>

        <h3 style={h3Style}>What's a "stale" lineage edge?</h3>
        <p style={pStyle}>
          An auto-derived edge (dbt) whose <code>lastSeenAt</code> is older than 30 days &mdash; meaning no recent import has confirmed it still exists. Stale edges render as dashed lines in the visualization and get a STALE badge in the table. Re-import the manifest to clear them, or remove them manually if the upstream model is genuinely gone.
        </p>

        <h3 style={h3Style}>How do I save a filtered view of a list page?</h3>
        <p style={pStyle}>
          On a list page with the <strong>Views</strong> button (Data Assets, Systems, Connections, Data Dictionary, Decision Rights, Governance Roles, Business Glossary, People), set your filters, click <em>Views</em>, then <em>+ Save current filters as view</em> and name it. Views are org-visible; only the owner can rename or delete their own.
        </p>

        <h3 style={h3Style}>How do I mention someone in a comment?</h3>
        <p style={pStyle}>
          Type <code>@</code> in any Discussion composer. A popover appears with people in the active org; arrow-key or click to pick one. The mentioned person sees an in-app notification with a link back to the comment.
        </p>

        <h3 style={h3Style}>Why does Custodian on a system look different from Data Custodian on the Governance Roles page?</h3>
        <p style={pStyle}>
          They're different roles. <em>System Custodian</em> is the technical caretaker of one specific system &mdash; per-system scope. <em>Data Custodian</em> (DAMA) is an enterprise-level role covering data storage, security, and access broadly. Click either badge to open the Role Detail drawer, where the scope badge ("Per system" vs. nothing) and the responsibilities list make the difference clear.
        </p>

        <h3 style={h3Style}>Can I undo a delete?</h3>
        <p style={pStyle}>
          Yes &mdash; when you delete a single item (data asset, system, person), a toast notification appears with an
          "Undo" button. Click it within 6 seconds to restore the item.
        </p>

        <h3 style={h3Style}>What governance framework does Procela follow?</h3>
        <p style={pStyle}>
          Procela follows the DAMA (Data Management Association) framework for data governance. Roles, groups,
          processes, and the governance hierarchy are all aligned with DAMA best practices.
        </p>

        <h3 style={h3Style}>Where is my data stored?</h3>
        <p style={pStyle}>
          In the current prototype, data is stored in JSON files on the server. In production, Procela is designed
          to use PostgreSQL with full multi-tenancy, encryption, and backup capabilities.
        </p>
      </div>

      {/* Keyboard shortcuts — list the chords plus a button that pops
          the same overlay the user gets from Shift+? globally. Keeps
          discoverability high without forcing users to know the chord. */}
      <div style={sectionStyle}>
        <h2 id="help-shortcuts" style={h2Style}>12. Keyboard shortcuts</h2>
        <p style={pStyle}>
          Procela has a small set of keyboard chords for the things you'll do most often.
          Press <kbd style={kbdStyle}>Shift</kbd> + <kbd style={kbdStyle}>?</kbd> anywhere
          to open the full reference, or use the button below.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
          <tbody>
            {[
              ['/', 'Open command palette'],
              ['Ctrl / Cmd + K', 'Open command palette'],
              ['Shift + ?', 'Show all keyboard shortcuts'],
              ['g then d', 'Go to Dashboard'],
              ['g then o', 'Go to Organizations'],
              ['g then p', 'Go to People'],
              ['g then c', 'Go to Processes'],
              ['g then a', 'Go to Data Assets'],
              ['g then s', 'Go to Systems'],
              ['g then m', 'Go to Process Coverage (mappings)'],
              ['g then l', 'Go to Lineage'],
              ['g then q', 'Go to Data Quality'],
              ['g then g', 'Go to Governance Program'],
              ['g then r', 'Go to Reports'],
              ['g then e', 'Go to Enterprise View'],
              ['g then h', 'Go to Help'],
              ['Escape', 'Close the palette, drawers, modals, and dropdowns'],
            ].map(([keys, what]) => (
              <tr key={keys} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                  <kbd style={kbdStyle}>{keys}</kbd>
                </td>
                <td style={{ padding: '6px 8px', color: 'var(--color-text-secondary)' }}>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() => window.dispatchEvent(new Event('procela:open-shortcuts'))}
          style={{
            padding: '8px 16px', background: 'var(--color-surface)',
            color: 'var(--color-primary)', border: '1px solid var(--color-primary)',
            borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}
        >
          Open keyboard shortcuts overlay
        </button>
      </div>
    </div>
  );
}
