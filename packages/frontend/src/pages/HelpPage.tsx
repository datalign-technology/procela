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

export default function HelpPage() {
  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Help Guide</h1>
      <p style={{ ...pStyle, marginBottom: 24 }}>
        Procela is a DAMA-aligned governance operating platform that helps organizations design, execute, and mature
        data governance using workflows, accountability models, and structured procedures.
      </p>

      {/* 1. Getting Started */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>1. Getting Started</h2>
        <ol style={{ ...listStyle, listStyle: 'decimal' }}>
          <li>Sign in using dev mode or your enterprise SSO credentials</li>
          <li>Go to <strong>Administer &rarr; Organizations</strong> to create your company structure</li>
          <li>Go to <strong>Administer &rarr; People</strong> to add team members and assign roles</li>
          <li>Go to <strong>Govern &rarr; Program</strong> to begin the 4-phase governance setup journey</li>
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
        <h2 style={h2Style}>2. Navigation</h2>
        <p style={pStyle}>The sidebar has 6 sections. Each page shows a tab strip for switching between related pages.</p>
        <ul style={listStyle}>
          <li><strong>Dashboard</strong> &mdash; Personalized home with your tasks, issues, domains, and KPIs</li>
          <li><strong>Catalog</strong> &mdash; Processes, Data Assets, Systems, Mappings, Glossary, Data Dictionary</li>
          <li><strong>Govern</strong> &mdash; Program, Data Domains, Groups, Decision Rights, RACI, Policies</li>
          <li><strong>Operate</strong> &mdash; Operations Manual, Procedures (SOPs), Calendar, Work (tasks/issues)</li>
          <li><strong>Analyze</strong> &mdash; Control Tower, Enterprise View, Gap Detection, Data Quality, Lineage, Reports</li>
          <li><strong>Administer</strong> &mdash; Organizations, People, Connections, Agents, Settings</li>
        </ul>
        <h3 style={h3Style}>Search</h3>
        <p style={pStyle}>Press <strong>Cmd/Ctrl+K</strong> or <strong>/</strong> to open global search. Results link directly to the matching item.</p>
        <h3 style={h3Style}>Organization Selector</h3>
        <p style={pStyle}>The "Working in" dropdown in the header scopes all data to the selected organization.</p>
      </div>

      {/* 3. Dashboard */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>3. Dashboard</h2>
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

      {/* 4. Catalog */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>4. Catalog</h2>
        <h3 style={h3Style}>Processes</h3>
        <ul style={listStyle}>
          <li>Hierarchical process catalog: Value Stream &rarr; Process &rarr; Activity</li>
          <li>AI-powered Value Stream Wizard generates industry-specific process hierarchies</li>
          <li>Clone value streams across divisions with one click</li>
          <li>Level-specific attributes: frequency, risk level, responsible role, automation level</li>
          <li>Status lifecycle: Draft &rarr; Active &rarr; Deprecated</li>
        </ul>
        <h3 style={h3Style}>Data Assets</h3>
        <ul style={listStyle}>
          <li>Register data assets in business terms with governance tier (Uncertified/Managed/Certified)</li>
          <li>Category filter: Operational, Governance, Reference, Analytical, Master</li>
          <li>Inline editing for governance tier and health score directly in the table</li>
          <li><strong>Link to Source</strong>: connect assets to database tables, files, or APIs in the add/edit form</li>
          <li>Expandable columns with data types and quality rules per column</li>
          <li>Bulk operations: set tier, assign owner for multiple assets at once</li>
        </ul>
        <h3 style={h3Style}>Systems</h3>
        <ul style={listStyle}>
          <li>Register applications and platforms with type sidebar (ERP, CRM, GIS, etc.)</li>
          <li>Business criticality rating (High/Medium/Low) with filter</li>
          <li>Inline editing for name and system type</li>
        </ul>
        <h3 style={h3Style}>Mappings</h3>
        <ul style={listStyle}>
          <li>Link data assets to process activities to track dependencies</li>
          <li>Batch Mapping Wizard: matrix interface for creating multiple mappings at once</li>
        </ul>
        <h3 style={h3Style}>Business Glossary</h3>
        <ul style={listStyle}>
          <li>Searchable dictionary of agreed-upon business terms</li>
          <li>Group by Category (Business, Technical, Regulatory, Metric) or Alphabetical</li>
          <li>Industry-specific seed terms based on your organization&apos;s industry</li>
          <li>Approval workflow: Draft &rarr; Proposed &rarr; Approved &rarr; Deprecated</li>
        </ul>
        <h3 style={h3Style}>Data Dictionary</h3>
        <ul style={listStyle}>
          <li>Publishable technical catalog of all data assets organized by domain</li>
          <li>Shows columns, data types, ownership, source connections, health scores</li>
          <li><strong>Print / Export PDF</strong> button for sharing with stakeholders and auditors</li>
        </ul>
      </div>

      {/* 5. Govern */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>5. Govern</h2>
        <h3 style={h3Style}>Governance Program</h3>
        <ul style={listStyle}>
          <li>4-phase setup journey with progress tracking per phase</li>
          <li>Define governance scope (what&apos;s in/out), guiding principles, and operating model</li>
          <li>Phase completion is computed automatically from your actual data</li>
          <li>Next-action recommendations guide you to the right page</li>
        </ul>
        <h3 style={h3Style}>Data Domains</h3>
        <ul style={listStyle}>
          <li>Logical groupings of data assets (e.g., Customer Data, Financial Data)</li>
          <li>Assign owners and stewards per domain</li>
          <li>Option to auto-create a Data Stewardship Team when creating a domain</li>
          <li>AI-generated domain suggestions based on your industry</li>
        </ul>
        <h3 style={h3Style}>Governance Groups</h3>
        <ul style={listStyle}>
          <li>Hierarchical governance bodies: Council &rarr; Office &rarr; Committee &rarr; Stewardship Teams</li>
          <li>Generate standard DAMA structure with one click</li>
          <li>Recommended groups based on your data domains (Explore Recommendations)</li>
          <li>Inline DAMA role assignment per group member</li>
        </ul>
        <h3 style={h3Style}>Decision Rights</h3>
        <ul style={listStyle}>
          <li>Document who Decides, Recommends, Approves, and is Informed for each governance decision</li>
          <li>10 standard seed decisions (approve policy, grant exception, close issue, etc.)</li>
        </ul>
        <h3 style={h3Style}>RACI Matrix</h3>
        <ul style={listStyle}>
          <li>Responsibility assignments per process: Responsible, Accountable, Consulted, Informed</li>
          <li>Auto-derived from ownership data and governance group membership</li>
        </ul>
        <h3 style={h3Style}>Policies &amp; Controls</h3>
        <ul style={listStyle}>
          <li>Create governance policies with auto-generated codes (POL-001)</li>
          <li>Review cycles: quarterly, semi-annual, annual, biennial</li>
          <li>Controls linked to policies with type (Preventive/Detective/Corrective)</li>
          <li>Automation mode per control: Human, Agent, or Hybrid</li>
        </ul>
        <h3 style={h3Style}>Dependency Enforcement</h3>
        <p style={pStyle}>
          Governance pages show prerequisite banners when prior steps haven&apos;t been completed.
          For example, the RACI page shows "Create domains and governance groups first" until those exist.
        </p>
      </div>

      {/* 6. Operate */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>6. Operate</h2>
        <h3 style={h3Style}>Operations Manual</h3>
        <ul style={listStyle}>
          <li>Role-specific runbooks for 7 DAMA roles (CDO, Governance Lead, Data Owner, etc.)</li>
          <li>Daily, weekly, monthly, and quarterly activities for each role</li>
          <li>Escalation paths with clear guidance on when and how to escalate</li>
        </ul>
        <h3 style={h3Style}>Procedures (SOPs)</h3>
        <ul style={listStyle}>
          <li>Step-by-step procedures for common governance activities</li>
          <li>5 seed SOPs: onboard data asset, quality incident, access request, escalation, quarterly review</li>
          <li>Each step has a title, description, and estimated time</li>
        </ul>
        <h3 style={h3Style}>Governance Calendar</h3>
        <ul style={listStyle}>
          <li>Recurring governance events: Council meetings, Committee syncs, stewardship huddles</li>
          <li>Cadence options: weekly, biweekly, monthly, quarterly, semi-annual, annual</li>
          <li>Auto-generate governance tasks per attendee when an event occurs</li>
          <li>Seed 4 standard events with one click</li>
        </ul>
        <h3 style={h3Style}>Governance Work</h3>
        <ul style={listStyle}>
          <li><strong>Tasks</strong>: workflow states (Draft &rarr; Open &rarr; In Progress &rarr; Pending Review &rarr; Completed), priority, assignee, due dates</li>
          <li><strong>Issues</strong>: 9 types (Metadata, Data Quality, Classification, Ownership, Policy, Access, Lineage, Compliance, Workflow), severity levels</li>
          <li>Steward onboarding: auto-creates 4 tasks when a steward role is assigned (7/14/21/90-day milestones)</li>
        </ul>
      </div>

      {/* 7. Analyze */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>7. Analyze</h2>
        <ul style={listStyle}>
          <li><strong>Control Tower</strong> &mdash; Operational dashboard: open issues/tasks, policy coverage, automation rate, coverage gaps</li>
          <li><strong>Enterprise View</strong> &mdash; Full cross-entity graph: processes, systems, assets, domains, people and their connections</li>
          <li><strong>Gap Detection</strong> &mdash; Unmapped process steps and ungoverned data assets</li>
          <li><strong>Data Quality</strong> &mdash; Quality rules per asset/column, dimensions (completeness, accuracy, timeliness), health score computation</li>
          <li><strong>Data Lineage</strong> &mdash; Upstream/downstream data flow visualization</li>
          <li><strong>Reports</strong> &mdash; Executive Report (printable/PDF) and Scorecard with governance health dimensions</li>
        </ul>
      </div>

      {/* 8. Administer */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>8. Administer</h2>
        <ul style={listStyle}>
          <li><strong>Organizations</strong> &mdash; Hierarchical structure (company &rarr; division &rarr; department &rarr; team), import from CSV/JSON, tree visualization</li>
          <li><strong>People</strong> &mdash; Team members with app roles (Super Admin, Org Admin, Editor, Contributor, Viewer), governance role assignments, org/role filters</li>
          <li><strong>Connections</strong> &mdash; Database, File Storage, API, Data Warehouse, Spreadsheet connections with test and discover capabilities</li>
          <li><strong>Agents</strong> &mdash; AI agent registry for future agent-enabled governance execution</li>
          <li><strong>Settings</strong> &mdash; Authentication (Dev Mode, Microsoft Entra ID, Okta), API configuration, backup and restore</li>
        </ul>
      </div>

      {/* 9. Key Concepts */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>9. Key Concepts</h2>
        <h3 style={h3Style}>DAMA Framework</h3>
        <p style={pStyle}>
          Procela follows the DAMA (Data Management Association) framework for data governance. The governance
          structure, roles, and processes are aligned with DAMA best practices.
        </p>
        <h3 style={h3Style}>Governance Tiers</h3>
        <ul style={listStyle}>
          <li><strong>Uncertified</strong> &mdash; Catalogued but not yet governed. No formal ownership or quality rules.</li>
          <li><strong>Managed</strong> &mdash; Owner and steward assigned, basic quality rules in place.</li>
          <li><strong>Certified</strong> &mdash; Fully governed, audit-ready data with complete documentation.</li>
        </ul>
        <h3 style={h3Style}>DAMA Roles</h3>
        <ul style={listStyle}>
          <li>Chief Data Officer (CDO), Data Governance Lead, Data Owner, Business Data Steward</li>
          <li>Technical Data Steward, Data Quality Analyst, Data Custodian</li>
          <li>Data Architect, Data Engineer, Database Administrator</li>
        </ul>
        <h3 style={h3Style}>Automation Modes</h3>
        <ul style={listStyle}>
          <li><strong>Human</strong> &mdash; Task performed entirely by a person</li>
          <li><strong>Agent</strong> &mdash; Task performed by an AI agent</li>
          <li><strong>Hybrid</strong> &mdash; Agent recommends, human approves</li>
        </ul>
      </div>

      {/* 10. Keyboard Shortcuts */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>10. Keyboard Shortcuts</h2>
        <ul style={listStyle}>
          <li><strong>Cmd/Ctrl + K</strong> or <strong>/</strong> &mdash; Focus search</li>
          <li><strong>Shift + ?</strong> &mdash; Open shortcuts reference</li>
          <li><strong>g then d</strong> &mdash; Go to Dashboard</li>
          <li><strong>g then o</strong> &mdash; Go to Organizations</li>
          <li><strong>g then p</strong> &mdash; Go to People</li>
          <li><strong>g then c</strong> &mdash; Go to Processes</li>
          <li><strong>g then a</strong> &mdash; Go to Data Assets</li>
          <li><strong>g then s</strong> &mdash; Go to Systems</li>
          <li><strong>g then m</strong> &mdash; Go to Mappings</li>
          <li><strong>g then q</strong> &mdash; Go to Data Quality</li>
          <li><strong>g then l</strong> &mdash; Go to Data Lineage</li>
          <li><strong>Escape</strong> &mdash; Close search, modals, and dropdowns</li>
        </ul>
      </div>

      {/* 11. FAQ */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>11. Frequently Asked Questions</h2>

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
          Standard Operating Procedures are step-by-step guides for common governance activities. You can seed 5
          standard SOPs or create your own. Each step includes a description and estimated time.
        </p>

        <h3 style={h3Style}>What does the Control Tower show?</h3>
        <p style={pStyle}>
          The Control Tower is your operational dashboard showing open issues, active tasks, policy coverage,
          automation rate, and coverage gaps across domains, assets, and processes.
        </p>

        <h3 style={h3Style}>How do I publish a Data Dictionary?</h3>
        <p style={pStyle}>
          Go to Catalog &rarr; Data Dictionary. Filter by domain, classification, or tier if needed, then click
          "Print / Export PDF" to generate a clean document for sharing with stakeholders.
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
    </div>
  );
}
