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
      </p>

      {/* Getting Started */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Getting Started</h2>
        <p style={pStyle}>
          Procela works in three phases: <strong>Define</strong> your business processes,{' '}
          <strong>Connect</strong> them to data and systems, then <strong>Discover</strong> gaps and governance opportunities.
        </p>
        <ol style={{ ...listStyle, listStyle: 'decimal' }}>
          <li>Sign in with your enterprise SSO credentials</li>
          <li>Set up your organization and select your industry</li>
          <li>Generate or build your process catalog</li>
          <li>Define your data assets and systems</li>
          <li>Map data to process steps</li>
          <li>Review gaps and governance dashboards</li>
        </ol>
      </div>

      {/* Process Catalog */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Process Catalog</h2>
        <p style={pStyle}>
          The process catalog is the heart of Procela. It organizes your business operations into a clear hierarchy:
        </p>
        <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', padding: 16, fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 12, color: 'var(--color-text)' }}>
          Value Stream → Process → Sub-Process → Step
        </div>

        <h3 style={h3Style}>What you can do</h3>
        <ul style={listStyle}>
          <li>Create, edit, rename, and delete items at any level</li>
          <li>Reorder processes and steps by dragging or using controls</li>
          <li>Add rich descriptions to each level</li>
          <li>Assign an owner to every process and step</li>
          <li>Track status: Draft, Active, Under Review, or Deprecated</li>
        </ul>

        <h3 style={h3Style}>Industry Templates</h3>
        <p style={pStyle}>
          Instead of starting from scratch, select your industry and let Procela AI generate a
          complete process hierarchy as a starting point. You can preview the template, accept it
          in full, accept parts of it, or start fresh.
        </p>
        <p style={pStyle}>Supported industries:</p>
        <ul style={listStyle}>
          <li>Utilities (electric, gas, water)</li>
          <li>Defense & Shipbuilding</li>
          <li>Healthcare</li>
          <li>Manufacturing</li>
          <li>Oil & Gas</li>
          <li>Financial Services</li>
          <li>Transportation & Logistics</li>
          <li>State & Local Government</li>
        </ul>
      </div>

      {/* Data Assets & Systems */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Data Assets & Systems</h2>
        <p style={pStyle}>
          Define the data your organization relies on — in plain business language, not technical schemas.
        </p>

        <h3 style={h3Style}>Data Assets</h3>
        <p style={pStyle}>
          A data asset is any meaningful collection of data your business uses: customer records,
          billing data, compliance reports, sensor readings, etc. Each asset includes:
        </p>
        <ul style={listStyle}>
          <li>Name and business description</li>
          <li>Owning system (where the data lives)</li>
          <li>Business owner and data steward</li>
          <li>Governance tier and health score</li>
        </ul>

        <h3 style={h3Style}>Governance Tiers</h3>
        <p style={pStyle}>
          Every data asset is classified into one of three tiers:
        </p>
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

        <h3 style={h3Style}>Systems</h3>
        <p style={pStyle}>
          Systems are the applications and platforms where data lives — ERP, CRM, GIS, data warehouses,
          spreadsheets, etc. Register your systems so data assets can be linked to them.
        </p>
      </div>

      {/* Mappings */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Process-to-Data Mapping</h2>
        <p style={pStyle}>
          Mappings connect your process steps to the data assets they consume or produce. This is where
          Procela bridges the gap between how your business works and what data supports it.
        </p>

        <h3 style={h3Style}>AI Suggestions</h3>
        <p style={pStyle}>
          When you map data to a process step, Procela AI can suggest relevant data assets and systems
          based on your industry and process context. For each suggestion you can:
        </p>
        <ul style={listStyle}>
          <li><strong>Accept</strong> — add the suggested link as-is</li>
          <li><strong>Modify</strong> — adjust the suggestion before adding</li>
          <li><strong>Dismiss</strong> — skip the suggestion</li>
        </ul>
        <p style={pStyle}>
          Every mapping tracks whether it was AI-suggested or user-defined, so you always know the
          provenance of your data landscape.
        </p>

        <h3 style={h3Style}>Reverse Lookup</h3>
        <p style={pStyle}>
          From any data asset, you can see all the processes that depend on it — helping you
          understand the blast radius of data quality issues.
        </p>
      </div>

      {/* Gap Detection */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Gap Detection</h2>
        <p style={pStyle}>
          Procela automatically identifies weaknesses in your process-data landscape:
        </p>
        <ul style={listStyle}>
          <li><strong>Unmapped steps</strong> — process steps with no linked data assets</li>
          <li><strong>Ungoverned assets</strong> — data assets at Bronze tier supporting critical processes</li>
          <li><strong>Ownership gaps</strong> — items with no assigned owner</li>
          <li><strong>Low health assets</strong> — data assets with health scores below threshold</li>
        </ul>
        <p style={pStyle}>
          Use the dashboard to get a portfolio-level view of coverage and take action on gaps.
        </p>
      </div>

      {/* AI Assistant */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>AI Assistant</h2>
        <p style={pStyle}>
          The AI assistant is available throughout Procela to answer questions about your
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
          mappings, and gaps. It will never fabricate data that doesn't exist in your catalog.
        </p>
      </div>

      {/* Dashboards */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Dashboards</h2>

        <h3 style={h3Style}>Executive Dashboard</h3>
        <p style={pStyle}>
          High-level view of portfolio health, gap summary, and governance tier breakdown across
          your entire organization.
        </p>

        <h3 style={h3Style}>Operational Dashboard</h3>
        <p style={pStyle}>
          Detailed view of process coverage, ownership gaps, and data health alerts for day-to-day
          governance work.
        </p>

        <p style={pStyle}>
          Both dashboards support export to PDF and CSV for compliance and audit purposes.
        </p>
      </div>

      {/* Roles */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Roles & Permissions</h2>
        <p style={pStyle}>
          Procela uses role-based access control tied to your enterprise identity provider:
        </p>
        <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse', marginTop: 8 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Role</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Access</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Super Admin', 'Full platform access, manages org settings and integrations'],
              ['Org Admin', 'Manages users, roles, and org-level configuration'],
              ['Process Owner', 'Create/edit/delete processes in their assigned domain'],
              ['Data Steward', 'Create/edit/delete data assets and system connections'],
              ['Contributor', 'Can edit items they are assigned to'],
              ['Viewer', 'Read-only access to the full catalog'],
            ].map(([role, access]) => (
              <tr key={role} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 500, whiteSpace: 'nowrap' }}>{role}</td>
                <td style={{ padding: '8px 12px', color: 'var(--color-text-secondary)' }}>{access}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* FAQ */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Frequently Asked Questions</h2>

        <h3 style={h3Style}>Do I need technical knowledge to use Procela?</h3>
        <p style={pStyle}>
          No. Procela is designed for business users. You describe processes and data in plain
          language — no SQL, no schemas, no code required.
        </p>

        <h3 style={h3Style}>Can I undo changes?</h3>
        <p style={pStyle}>
          Every change in Procela is recorded in the audit log. While there's no one-click undo,
          you can always see what changed, when, and by whom — and manually revert if needed.
        </p>

        <h3 style={h3Style}>How does the AI know about my industry?</h3>
        <p style={pStyle}>
          When you select your industry during setup, Procela uses that context to generate
          relevant templates and suggestions. The AI draws on broad knowledge of industry-standard
          processes but always lets you override with your organization's specifics.
        </p>

        <h3 style={h3Style}>Is my data secure?</h3>
        <p style={pStyle}>
          Yes. All authentication goes through your enterprise identity provider (Azure AD, Okta,
          or SAML/OIDC). All AI processing happens server-side — no data is sent to third parties
          beyond the AI API calls needed for suggestions and templates.
        </p>

        <h3 style={h3Style}>Can I export my data?</h3>
        <p style={pStyle}>
          Yes. Dashboards and reports can be exported to PDF and CSV. The audit log is also
          exportable for compliance purposes.
        </p>
      </div>
    </div>
  );
}
