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
};

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

const badgeStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 600,
  color: '#fff',
  background: color,
  marginRight: 6,
});

export default function HelpPage() {
  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Help Guide</h1>
      <p style={{ ...pStyle, marginBottom: 24 }}>
        Welcome to Procela — the platform that connects your business processes to the data and systems that support them.
        This guide covers every feature available in the application.
      </p>

      {/* Getting Started */}
      <div id="getting-started" style={sectionStyle}>
        <h2 style={h2Style}>1. Getting Started</h2>
        <p style={pStyle}>
          Procela helps you define how your business works, describe the data behind each step,
          and discover governance opportunities. Here is the recommended path to get up and running:
        </p>
        <ol style={{ ...listStyle, listStyle: 'decimal' }}>
          <li>Sign in using dev mode (for prototyping) or your enterprise SSO credentials</li>
          <li>Set up your organization hierarchy — create your company, divisions, and departments</li>
          <li>Add people to your organization and assign them roles</li>
          <li>Select an organization to work in using the "Working in" dropdown in the header</li>
          <li>Define your business processes using the Value Stream Wizard or build them manually</li>
          <li>Register the systems and data assets your organization relies on</li>
          <li>Set up data governance — create governance groups, data domains, and assign governance roles</li>
          <li>Map data assets to process activities to connect your business and data layers</li>
          <li>Review gaps and dashboards to identify areas that need attention</li>
        </ol>
      </div>

      {/* Organizations & People */}
      <div id="organizations" style={sectionStyle}>
        <h2 style={h2Style}>2. Organizations & People</h2>
        <p style={pStyle}>
          Before defining processes or data, you need to set up your organizational structure. Procela supports
          a full hierarchical model that mirrors how your enterprise is organized.
        </p>

        <h3 style={h3Style}>Organization Hierarchy</h3>
        <p style={pStyle}>
          Organizations are arranged in a five-level hierarchy:
        </p>
        <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', padding: 16, fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 12, color: 'var(--color-text)' }}>
          Company &gt; Division &gt; Department &gt; Team &gt; Unit
        </div>
        <ul style={listStyle}>
          <li>The Organizations page uses a side-by-side layout: the org tree on the left, people on the right</li>
          <li>Industry is set at the company or division level and inherited by child organizations</li>
          <li>Value streams can only be created at the company or division level</li>
        </ul>

        <h3 style={h3Style}>People</h3>
        <ul style={listStyle}>
          <li>People are added to your organization and assigned roles (Super Admin, Org Admin, etc.)</li>
          <li>A person can be assigned to multiple organization levels</li>
          <li>People appear in the right panel when you select an org node in the tree</li>
        </ul>

        <h3 style={h3Style}>Import</h3>
        <p style={pStyle}>
          Both organizations and people can be imported in bulk via CSV or JSON. Use the file browse
          dialog or paste content directly.
        </p>

        <h3 style={h3Style}>Working In</h3>
        <p style={pStyle}>
          The "Working in" dropdown in the header controls which organization's data you see throughout
          the application. All processes, systems, data assets, and governance structures are scoped to the
          active organization. Switch organizations at any time using this dropdown.
        </p>
      </div>

      {/* Process Catalog */}
      <div id="process-catalog" style={sectionStyle}>
        <h2 style={h2Style}>3. Process Catalog</h2>
        <p style={pStyle}>
          The process catalog is the heart of Procela. It organizes your business operations into
          a universal eight-level hierarchy:
        </p>
        <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', padding: 16, fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 12, color: 'var(--color-text)' }}>
          Value Stream &gt; Domain &gt; Capability &gt; Process &gt; Sub-Process &gt; Activity &gt; Task &gt; System/Execution
        </div>

        <h3 style={h3Style}>Required Path</h3>
        <p style={pStyle}>
          Not every level is required. The minimum path to a complete process definition is:
        </p>
        <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', padding: 16, fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 12, color: 'var(--color-text)' }}>
          Value Stream &rarr; Process &rarr; Activity
        </div>
        <p style={pStyle}>
          All other levels (Domain, Capability, Sub-Process, Task, System/Execution) are optional and
          can be used for progressive elaboration as your organization matures.
        </p>

        <h3 style={h3Style}>Value Stream Wizard</h3>
        <p style={pStyle}>
          Instead of building from scratch, use the Value Stream Wizard to have AI generate a complete
          process hierarchy based on your organization's industry. The industry is sourced from your
          organization settings and inherited down the org tree. You can preview the generated hierarchy,
          accept it in full, accept parts of it, or start fresh.
        </p>

        <h3 style={h3Style}>Editing and Status</h3>
        <ul style={listStyle}>
          <li>Inline editing — click any item to rename or update its description</li>
          <li>Status lifecycle: <span style={badgeStyle('#6b7280')}>Draft</span> <span style={badgeStyle('#0f4f46')}>Active</span> <span style={badgeStyle('#9d174d')}>Deprecated</span></li>
          <li>Transitions: Draft ↔ Active, Active → Deprecated, Deprecated → Draft</li>
          <li>Items in Active or Deprecated status are <strong>locked for editing</strong>. Change the status back to Draft to make edits.</li>
          <li>ACTIVE status is blocked until the required path (Value Stream, Process, Activity) is complete</li>
          <li>Guided prompts and a completeness checklist help you fill in all required information</li>
        </ul>

        <h3 style={h3Style}>Documentation Fields</h3>
        <p style={pStyle}>
          Expand a process node to see and edit documentation fields. These appear as inline-editable
          label/value rows below the description:
        </p>
        <ul style={listStyle}>
          <li><strong>Purpose</strong> — what does this process accomplish? (Value Streams, Processes)</li>
          <li><strong>Business Outcome</strong> — what value does this deliver? (Value Streams)</li>
          <li><strong>Stakeholders</strong> — who cares about this? (Value Streams, Processes)</li>
          <li><strong>Inputs / Outputs</strong> — what goes in, what comes out? (Processes, Activities)</li>
          <li><strong>Compliance Tags</strong> — SOX, HIPAA, GDPR, etc. Comma-separated. (Value Streams, Processes)</li>
          <li><strong>Responsible Role</strong> — who performs this activity? (Activities)</li>
        </ul>

        <h3 style={h3Style}>Activities</h3>
        <ul style={listStyle}>
          <li>Activities are the primary unit for data mapping and gap detection</li>
          <li>Each activity receives a unique ID (ACT-0001, ACT-0002, ...)</li>
          <li>Activity flow relationships define how activities connect: Sequence, Parallel, Conditional, or Loop</li>
        </ul>

        <h3 style={h3Style}>Visualization</h3>
        <p style={pStyle}>
          View your process hierarchy as a visual diagram. The visualization can be exported to PDF
          for documentation and sharing.
        </p>
      </div>

      {/* Systems */}
      <div id="systems" style={sectionStyle}>
        <h2 style={h2Style}>4. Systems</h2>
        <p style={pStyle}>
          Systems are the applications and platforms where your organization's data lives. Register
          your systems so data assets can be linked to them.
        </p>
        <ul style={listStyle}>
          <li>Each system has a name, description, and type (ERP, CRM, GIS, SCADA, Data Warehouse, etc.)</li>
          <li><strong>Business Criticality</strong> — High, Medium, or Low. Indicates how critical the system is to operations.</li>
          <li><strong>Vendor / Platform</strong> — the vendor or technology (e.g. SAP, Salesforce, Custom)</li>
          <li><strong>Integration Points</strong> — which other systems this connects to and how</li>
          <li>Systems can be imported in bulk via CSV or JSON</li>
          <li>All systems are scoped to the active organization selected in the header</li>
        </ul>
      </div>

      {/* Data Assets */}
      <div id="data-assets" style={sectionStyle}>
        <h2 style={h2Style}>5. Data Assets</h2>
        <p style={pStyle}>
          Define the data your organization relies on — in plain business language, not technical schemas.
          A data asset is any meaningful collection of data: customer records, billing data, compliance
          reports, sensor readings, and so on.
        </p>

        <h3 style={h3Style}>Asset Properties</h3>
        <ul style={listStyle}>
          <li>Name and business description</li>
          <li>Linked system (where the data lives)</li>
          <li>Domain assignment — which data domain governs this asset</li>
          <li>Business owner and data steward</li>
          <li>Governance tier and health score</li>
          <li><strong>Data Classification</strong> — Public, Internal, Confidential, or Restricted. Controls how sensitive the data is.</li>
          <li><strong>Retention Policy</strong> — how long the data is kept (e.g. "7 years per SOX requirement")</li>
          <li><strong>Refresh Frequency</strong> — how often the data is updated: Real-time, Hourly, Daily, Weekly, Monthly, or Manual</li>
        </ul>

        <h3 style={h3Style}>Columns / Fields</h3>
        <p style={pStyle}>
          Each data asset can have columns or fields discovered from a linked connection.
          Expand an asset to see its columns, their data types, and any data quality rules
          attached to each column. Columns are auto-discovered when you link a connection,
          or can be added manually.
        </p>

        <h3 style={h3Style}>Governance Tiers</h3>
        <div style={{ marginBottom: 12 }}>
          <p style={{ ...pStyle, marginBottom: 4 }}>
            <span style={badgeStyle('#a8803c')}>Bronze</span> Raw or minimally managed data
          </p>
          <p style={{ ...pStyle, marginBottom: 4 }}>
            <span style={badgeStyle('#6b7280')}>Silver</span> Managed data with defined ownership
          </p>
          <p style={{ ...pStyle, marginBottom: 4 }}>
            <span style={badgeStyle('#b8860b')}>Gold</span> Fully governed and certified
          </p>
        </div>

        <h3 style={h3Style}>Health Scores</h3>
        <p style={pStyle}>
          Each data asset has a health score from 0 to 100, computed as the weighted average of
          all quality rule scores: <em>Health = &Sigma;(score &times; weight) / &Sigma;(weight)</em>.
          Health updates automatically when rules are run. Hover over the health bar on the
          Data Quality page to see the full breakdown.
        </p>

        <h3 style={h3Style}>360 View</h3>
        <p style={pStyle}>
          The 360 View for a data asset shows its data domain, all process mappings, ownership
          details, and governance status in a single consolidated view.
        </p>

        <p style={pStyle}>
          All data assets are scoped to the active organization selected in the header.
        </p>
      </div>

      {/* Data Governance */}
      <div id="data-governance" style={sectionStyle}>
        <h2 style={h2Style}>6. Data Governance</h2>
        <p style={pStyle}>
          Procela provides a comprehensive data governance framework aligned with industry-standard data governance best practices.
          Governance is organized into three areas: Governance Groups, Data Domains, and Governance Roles.
        </p>

        <h3 style={h3Style}>Governance Groups</h3>
        <p style={pStyle}>
          Governance groups form the organizational structure for data governance. They follow a
          Recommended hierarchy:
        </p>
        <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', padding: 16, fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 12, color: 'var(--color-text)' }}>
          Council &gt; Office &gt; Committee &gt; Stewardship Team &gt; Working Group &gt; Community of Practice
        </div>
        <ul style={listStyle}>
          <li>Use "Generate Governance Template" to create a starter governance structure automatically</li>
          <li>The hierarchy levels are soft recommendations — they are not rigidly enforced</li>
          <li>Each group has members with roles: Chair, Vice Chair, Member, Secretary, or Advisor</li>
          <li>Visualize your governance structure as a diagram and export it to PDF</li>
        </ul>

        <h3 style={h3Style}>Data Domains</h3>
        <p style={pStyle}>
          Data domains group related data assets into governed categories such as Customer Data,
          Financial Data, Product Data, and so on.
        </p>
        <ul style={listStyle}>
          <li>Assign a Data Owner and one or more Data Stewards to each domain</li>
          <li>Link data assets to domains to establish governance coverage</li>
          <li><strong>Scope Definition</strong> — define what data falls in or out of this domain</li>
          <li>Status lifecycle: Draft ↔ Active → Deprecated → Draft (same as processes)</li>
          <li>Editing is locked when status is Active or Deprecated</li>
          <li>Track which domains are fully governed and which have gaps</li>
        </ul>

        <h3 style={h3Style}>Governance Roles</h3>
        <p style={pStyle}>
          Governance roles define the data management responsibilities held by people in your organization.
          Procela supports seven role types:
        </p>
        <ul style={listStyle}>
          <li><strong>CDO</strong> — Chief Data Officer, enterprise-level data strategy</li>
          <li><strong>Data Governance Lead</strong> — oversees the governance program</li>
          <li><strong>Data Owner</strong> — accountable for a data domain or asset</li>
          <li><strong>Data Steward</strong> — manages data quality and standards day-to-day</li>
          <li><strong>Data Custodian</strong> — technical management of data storage and infrastructure</li>
          <li><strong>Data Architect</strong> — designs data models and integration patterns</li>
          <li><strong>Data Quality Analyst</strong> — monitors and improves data quality</li>
        </ul>
        <p style={pStyle}>
          Governance roles are scoped to an Organization. Domain ownership is managed directly on
          the Data Domain (owner and steward fields). A person can hold multiple governance roles.
        </p>
      </div>

      {/* Mappings */}
      <div id="mappings" style={sectionStyle}>
        <h2 style={h2Style}>7. Mappings</h2>
        <p style={pStyle}>
          Mappings connect your process activities to the data assets they depend on. This is where
          Procela bridges the gap between how your business works and what data supports it.
        </p>

        <h3 style={h3Style}>Creating Mappings</h3>
        <ul style={listStyle}>
          <li>Link data assets to process activities using the hierarchical step selector</li>
          <li>Choose a link type for each mapping: <strong>Consumes</strong>, <strong>Produces</strong>, <strong>Transforms</strong>, or <strong>References</strong></li>
          <li>Use bulk select to create or delete multiple mappings at once</li>
        </ul>

        <h3 style={h3Style}>AI Suggestions</h3>
        <p style={pStyle}>
          When you create mappings, Procela AI can suggest relevant data assets based on your industry
          and process context. AI-suggested mappings are marked with a badge so you always know the
          provenance of each link.
        </p>

        <h3 style={h3Style}>Reverse Lookup</h3>
        <p style={pStyle}>
          From any data asset, you can see all the processes that depend on it — helping you
          understand the blast radius of data quality issues or system changes.
        </p>
      </div>

      {/* Gap Detection */}
      {/* Data Quality */}
      <div id="data-quality" style={sectionStyle}>
        <h2 style={h2Style}>8. Data Quality</h2>
        <p style={pStyle}>
          Define quality rules for your data assets and compute health scores automatically.
          Rules are attached to specific columns/fields within an asset.
        </p>

        <h3 style={h3Style}>Rule Types</h3>
        <ul style={listStyle}>
          <li><strong>NOT_NULL</strong> — checks that a column has no null values</li>
          <li><strong>UNIQUE</strong> — checks that all values are unique</li>
          <li><strong>REGEX_MATCH</strong> — validates values against a regular expression pattern</li>
          <li><strong>IN_SET</strong> — checks that values are in an allowed set</li>
          <li><strong>NUMERIC_RANGE</strong> — validates values fall within a min/max range</li>
          <li><strong>LENGTH_RANGE</strong> — validates string length within bounds</li>
          <li><strong>CUSTOM</strong> — user-defined validation logic</li>
        </ul>

        <h3 style={h3Style}>Running Rules</h3>
        <ul style={listStyle}>
          <li>Click the <strong>play button</strong> on any rule to run it immediately</li>
          <li>Use <strong>Run All Rules</strong> on an asset row to execute every rule at once</li>
          <li>Results update the rule's score, status, and the asset's overall health</li>
        </ul>

        <h3 style={h3Style}>Scheduling</h3>
        <ul style={listStyle}>
          <li>Click the <strong>clock icon</strong> on any rule to set a schedule</li>
          <li>Options: Manual only, Hourly, Daily, or Weekly</li>
          <li>Scheduled rules run automatically; the next run time is shown in the schedule dropdown</li>
        </ul>

        <h3 style={h3Style}>Health Score Calculation</h3>
        <p style={pStyle}>
          Asset health = weighted average of all rule scores. Each rule has a weight (1–10, default 5).
          Formula: <em>&Sigma;(currentScore &times; weight) / &Sigma;(weight)</em>.
          New rules start at 0% until run. Hover over the health bar for a full breakdown.
        </p>
      </div>

      {/* Gap Detection */}
      <div id="gap-detection" style={sectionStyle}>
        <h2 style={h2Style}>9. Gap Detection</h2>
        <p style={pStyle}>
          Procela identifies 8 categories of gaps across your organization, grouped by severity:
        </p>
        <h3 style={h3Style}>Critical</h3>
        <ul style={listStyle}>
          <li><strong>Unmapped Activities</strong> — process activities with no linked data assets</li>
          <li><strong>Ownership Gaps</strong> — value streams and processes with no assigned owner</li>
        </ul>
        <h3 style={h3Style}>Warning</h3>
        <ul style={listStyle}>
          <li><strong>Ungoverned Assets</strong> — Bronze-tier assets linked to processes</li>
          <li><strong>Low-Health Assets</strong> — assets with health below 50% linked to processes</li>
          <li><strong>Unowned Domains</strong> — data domains without an owner</li>
        </ul>
        <h3 style={h3Style}>Informational</h3>
        <ul style={listStyle}>
          <li><strong>Orphaned Assets</strong> — assets not assigned to any data domain</li>
          <li><strong>Unlinked Assets</strong> — assets with no process mapping</li>
          <li><strong>Unassigned People</strong> — people with no ownership or stewardship anywhere</li>
        </ul>
        <p style={pStyle}>
          Each gap category shows a count badge and can be expanded to see the specific items.
          A green "Clear" badge indicates no gaps in that category.
        </p>
      </div>

      {/* Enterprise View */}
      <div id="enterprise-view" style={sectionStyle}>
        <h2 style={h2Style}>10. Enterprise View</h2>
        <p style={pStyle}>
          A single-page overview showing all processes, systems, data assets, domains, and people
          across the organization with their relationships.
        </p>

        <h3 style={h3Style}>Summary Cards</h3>
        <p style={pStyle}>
          The top row shows count cards for each entity type. Click any card to expand and see
          the items in that category. A Relationships card shows the total number of connections.
        </p>

        <h3 style={h3Style}>Impact Analysis</h3>
        <ul style={listStyle}>
          <li>Click any item to select it — the sidebar shows its full dependency chain</li>
          <li>Unrelated items dim; connected items stay visible</li>
          <li><strong>Direct Connections</strong> shows immediate neighbors with relationship type</li>
          <li><strong>Full Impact</strong> shows all transitively connected entities, grouped by type</li>
          <li>Use this to answer: "If this system goes down, what processes are affected?"</li>
        </ul>
      </div>

      {/* Dashboards */}
      <div id="dashboards" style={sectionStyle}>
        <h2 style={h2Style}>11. Dashboard</h2>
        <p style={pStyle}>
          The dashboard provides an at-a-glance view of your organization's process and data landscape.
        </p>

        <h3 style={h3Style}>Getting Started Checklist</h3>
        <p style={pStyle}>
          When your organization is new and data is sparse, the dashboard displays a getting-started
          checklist to guide you through initial setup steps.
        </p>

        <h3 style={h3Style}>Live Metrics</h3>
        <ul style={listStyle}>
          <li>Process-to-data coverage percentage</li>
          <li>Average data health scores</li>
          <li>Governance tier breakdown (Bronze / Silver / Gold)</li>
          <li>Alerts for governance gaps and ungoverned assets</li>
        </ul>

        <h3 style={h3Style}>Recent Activity</h3>
        <p style={pStyle}>
          A recent activity feed pulled from the audit log shows the latest changes across your
          organization. The dashboard is scoped to the active organization selected in the header.
        </p>
      </div>

      {/* AI Features */}
      <div id="ai-assistant" style={sectionStyle}>
        <h2 style={h2Style}>12. AI Features</h2>
        <p style={pStyle}>
          Procela uses Anthropic's Claude API to provide AI capabilities throughout the platform.
        </p>

        <h3 style={h3Style}>Value Stream Wizard</h3>
        <p style={pStyle}>
          The AI-powered wizard generates a complete process hierarchy based on your organization's
          industry. Select your industry, preview the generated structure, and accept or modify
          any part of it before applying.
        </p>

        <h3 style={h3Style}>AI Chat</h3>
        <p style={pStyle}>
          A floating AI chat panel is available on every page. Use it to ask questions about your
          process-data landscape in plain English. Try asking:
        </p>
        <ul style={{ ...listStyle, fontStyle: 'italic' }}>
          <li>"Where are our data gaps?"</li>
          <li>"What data supports our regulatory reporting process?"</li>
          <li>"Which assets are below 80% health and linked to critical processes?"</li>
          <li>"Who owns the customer onboarding process?"</li>
        </ul>
        <p style={pStyle}>
          The assistant is context-aware — it knows your organization's catalog, data assets,
          mappings, and governance structure. It will never fabricate data that does not exist
          in your catalog. If asked about something outside the catalog, it will acknowledge the
          gap and offer to help define it.
        </p>
      </div>

      {/* Roles & Permissions */}
      <div id="roles" style={sectionStyle}>
        <h2 style={h2Style}>13. Roles & Permissions</h2>
        <p style={pStyle}>
          Procela uses role-based access control. Your role is shown under your name in the header.
        </p>
        <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse', marginTop: 8, marginBottom: 16 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Role</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Access</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Super Admin', 'Full access to all features and all organizations. Sees Administration section.'],
              ['Org Admin', 'Manages their assigned organization(s). Sees Administration section.'],
              ['Editor', 'Full read/write on processes, systems, data assets, and mappings. No admin access.'],
              ['Contributor', 'Limited write access to processes and data assets. Read-only for systems.'],
              ['Viewer', 'Read-only access across the catalog. Can export data but cannot create or edit.'],
            ].map(([role, access]) => (
              <tr key={role} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 500, whiteSpace: 'nowrap' }}>{role}</td>
                <td style={{ padding: '8px 12px', color: 'var(--color-text-secondary)' }}>{access}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={h3Style}>What Each Role Sees</h3>
        <ul style={listStyle}>
          <li><strong>Sidebar</strong> — the Administration section (Organizations, People, Agents, Systems, Connections, Governance) is only visible to Super Admin and Org Admin</li>
          <li><strong>Action buttons</strong> — Add, Edit, Delete, and Generate buttons are hidden for Viewers and limited for Contributors</li>
          <li><strong>Export</strong> — CSV export is available to all roles</li>
        </ul>

        <h3 style={h3Style}>Organization Access</h3>
        <ul style={listStyle}>
          <li>Each user is assigned to one or more organizations</li>
          <li>Your role applies within your assigned org(s)</li>
          <li>The "Working in" dropdown shows only organizations you have access to</li>
        </ul>
      </div>

      {/* Settings & Security */}
      <div id="settings" style={sectionStyle}>
        <h2 style={h2Style}>14. Settings & Security</h2>

        <h3 style={h3Style}>Authentication</h3>
        <p style={pStyle}>
          Procela supports multiple authentication methods:
        </p>
        <ul style={listStyle}>
          <li><strong>Dev Mode</strong> — simplified login for prototyping and development</li>
          <li><strong>Microsoft Entra ID (OIDC)</strong> — enterprise SSO via Azure AD</li>
          <li><strong>Okta (OIDC)</strong> — enterprise SSO via Okta</li>
        </ul>

        <h3 style={h3Style}>Session Management</h3>
        <ul style={listStyle}>
          <li>Access tokens expire after 15 minutes and are refreshed automatically</li>
          <li>Refresh tokens are valid for 8 hours</li>
          <li>A session timeout warning appears before expiration, with an option to extend</li>
        </ul>

        <h3 style={h3Style}>API Configuration</h3>
        <p style={pStyle}>
          The Settings page shows the status of the Anthropic API key used for AI features.
          SSO provider configuration is also managed from Settings.
        </p>
      </div>

      {/* Import & Export */}
      <div id="import-export" style={sectionStyle}>
        <h2 style={h2Style}>15. Import & Export</h2>

        <h3 style={h3Style}>Importing Data</h3>
        <p style={pStyle}>
          The following data types can be imported via CSV or JSON:
        </p>
        <ul style={listStyle}>
          <li>Organizations</li>
          <li>People</li>
          <li>Systems</li>
        </ul>
        <p style={pStyle}>
          Use the file browse dialog to select a file, or paste content directly into the import form.
        </p>

        <h3 style={h3Style}>Exporting Data</h3>
        <p style={pStyle}>
          CSV export is available on the following pages:
        </p>
        <ul style={listStyle}>
          <li>Systems</li>
          <li>Data Assets</li>
          <li>Data Quality Rules</li>
          <li>Mappings</li>
          <li>Governance Groups</li>
          <li>Governance Roles</li>
          <li>People</li>
        </ul>

        <h3 style={h3Style}>PDF Export</h3>
        <p style={pStyle}>
          Process visualizations and governance structure diagrams can be exported to PDF for
          documentation, presentations, and compliance purposes.
        </p>

        <h3 style={h3Style}>Delete All</h3>
        <p style={pStyle}>
          Each data type page includes a "Delete All" option to clear all records of that type.
          Use this to reset and reimport data as needed.
        </p>
      </div>

      {/* FAQ */}
      <div id="faq" style={sectionStyle}>
        <h2 style={h2Style}>16. Frequently Asked Questions</h2>

        <h3 style={h3Style}>Do I need technical knowledge to use Procela?</h3>
        <p style={pStyle}>
          No. Procela is designed for business users. You describe processes and data in plain
          language — no SQL, no schemas, no code required.
        </p>

        <h3 style={h3Style}>Can I undo changes?</h3>
        <p style={pStyle}>
          Every change in Procela is recorded in the audit log. You can always see what changed,
          when, and by whom. Use this information to manually revert if needed.
        </p>

        <h3 style={h3Style}>How does the AI know about my industry?</h3>
        <p style={pStyle}>
          The AI reads your organization's industry setting, which is configured at the company
          or division level. This context drives template generation and data suggestions throughout
          the platform.
        </p>

        <h3 style={h3Style}>Is my data secure?</h3>
        <p style={pStyle}>
          Yes. Authentication is handled via enterprise SSO (Microsoft Entra ID or Okta). Sessions
          use JWT tokens with short-lived access tokens and role-based access control. All AI
          processing happens server-side — your API key is never exposed to the browser.
        </p>

        <h3 style={h3Style}>Can I export data?</h3>
        <p style={pStyle}>
          Yes. CSV export is available on all major data tables (Systems, Data Assets, Mappings,
          Governance Groups, Governance Roles, People). Process and governance visualizations can be
          exported to PDF.
        </p>

        <h3 style={h3Style}>What governance framework does Procela follow?</h3>
        <p style={pStyle}>
          Procela's governance framework is aligned with industry-standard data governance frameworks
          and best practices, including principles from the Data Management Body of Knowledge (DMBOK2).
          It defines roles, groups, and organizational structures for effective data governance.
        </p>

        <h3 style={h3Style}>How do I reset everything?</h3>
        <p style={pStyle}>
          Each data page includes a "Delete All" option that clears all records of that type for
          your organization. Use this to start fresh or reimport data.
        </p>

        <h3 style={h3Style}>Where is my data stored?</h3>
        <p style={pStyle}>
          In the prototype, data is stored in JSON files on the server. The architecture is designed
          for PostgreSQL in production, with multi-tenant isolation via organization IDs on every record.
        </p>
      </div>
    </div>
  );
}
