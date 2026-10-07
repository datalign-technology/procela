import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Eager: Layout is on every authenticated page so a lazy boundary
// gains nothing. LoginPage is the unauthenticated entry — keep its
// first paint as fast as possible. Everything else is route-level
// code-split with React.lazy(); each page becomes its own chunk and
// only downloads when the user navigates to it.
import Layout from '@/components/Layout';
import { BreadcrumbProvider } from '@/components/BreadcrumbContext';
import Spinner from '@/components/Spinner';
import LoginPage from '@/pages/LoginPage';

const OidcCompletePage           = lazy(() => import('@/pages/OidcCompletePage'));
const DashboardPage              = lazy(() => import('@/pages/DashboardPage'));
const ProcessCatalogPage         = lazy(() => import('@/pages/ProcessCatalogPage'));
const ValueStreamWizard          = lazy(() => import('@/pages/ValueStreamWizard'));
const ProcessVisualizationPage   = lazy(() => import('@/pages/ProcessVisualizationPage'));
const ProcessDataMapPage         = lazy(() => import('@/pages/ProcessDataMapPage'));
const ComparisonPage             = lazy(() => import('@/pages/ComparisonPage'));
const SystemsAndDataPage         = lazy(() => import('@/pages/SystemsAndDataPage'));
const AnalyzePage                = lazy(() => import('@/pages/AnalyzePage'));
const DataAssetsHubPage          = lazy(() => import('@/pages/DataAssetsHubPage'));
const DataAssetDetailPage        = lazy(() => import('@/pages/DataAssetDetailPage'));
const DataQualityRuleDetailPage  = lazy(() => import('@/pages/DataQualityRuleDetailPage'));
const SystemsHubPage             = lazy(() => import('@/pages/SystemsHubPage'));
const SystemDetailPage           = lazy(() => import('@/pages/SystemDetailPage'));
const ConnectionDetailPage       = lazy(() => import('@/pages/ConnectionDetailPage'));
const GapDetectionPage           = lazy(() => import('@/pages/GapDetectionPage'));
const OrganizationsPage          = lazy(() => import('@/pages/OrganizationsPage'));
const OrganizationDetailPage     = lazy(() => import('@/pages/OrganizationDetailPage'));
const OrgVisualizationPage       = lazy(() => import('@/pages/OrgVisualizationPage'));
const PeoplePage                 = lazy(() => import('@/pages/PeoplePage'));
const PersonDetailPage           = lazy(() => import('@/pages/PersonDetailPage'));
const AgentsPage                 = lazy(() => import('@/pages/AgentsPage'));
const AgentDetailPage            = lazy(() => import('@/pages/AgentDetailPage'));
const SkillsPage                 = lazy(() => import('@/pages/SkillsPage'));
const SkillDetailPage            = lazy(() => import('@/pages/SkillDetailPage'));
const GovernanceGroupsPage       = lazy(() => import('@/pages/GovernanceGroupsPage'));
const GovernanceGroupDetailPage  = lazy(() => import('@/pages/GovernanceGroupDetailPage'));
const GovernanceVisualizationPage= lazy(() => import('@/pages/GovernanceVisualizationPage'));
const DataDomainsPage            = lazy(() => import('@/pages/DataDomainsPage'));
const DocumentationPage          = lazy(() => import('@/pages/DocumentationPage'));
const RolesPage                  = lazy(() => import('@/pages/RolesPage'));
const DataLineagePage            = lazy(() => import('@/pages/DataLineagePage'));
const GovernanceWorkPage         = lazy(() => import('@/pages/GovernanceWorkPage'));
const GovernanceTaskDetailPage   = lazy(() => import('@/pages/GovernanceTaskDetailPage'));
const GovernanceIssueDetailPage  = lazy(() => import('@/pages/GovernanceIssueDetailPage'));
const GovernancePoliciesPage     = lazy(() => import('@/pages/GovernancePoliciesPage'));
const GovernanceCalendarPage     = lazy(() => import('@/pages/GovernanceCalendarPage'));
const DecisionRightsPage         = lazy(() => import('@/pages/DecisionRightsPage'));
const DecisionRightDetailPage    = lazy(() => import('@/pages/DecisionRightDetailPage'));
const GovernanceRoleDetailPage   = lazy(() => import('@/pages/GovernanceRoleDetailPage'));
const GovernanceDocumentDetailPage = lazy(() => import('@/pages/GovernanceDocumentDetailPage'));
const BusinessGlossaryPage       = lazy(() => import('@/pages/BusinessGlossaryPage'));
const GlossaryTermDetailPage     = lazy(() => import('@/pages/GlossaryTermDetailPage'));
const GovernanceFoundationPage   = lazy(() => import('@/pages/GovernanceFoundationPage'));
const EnterpriseViewPage         = lazy(() => import('@/pages/EnterpriseViewPage'));
const AnalysisPage               = lazy(() => import('@/pages/AnalysisPage'));
const ReportsPage                = lazy(() => import('@/pages/ReportsPage'));
const ReportDetailPage           = lazy(() => import('@/pages/ReportDetailPage'));
const ReportBuilderPage          = lazy(() => import('@/pages/ReportBuilderPage'));
const CouncilPage                = lazy(() => import('@/pages/CouncilPage'));
const GovernanceExceptionsPage   = lazy(() => import('@/pages/GovernanceExceptionsPage'));
const AuditLogPage               = lazy(() => import('@/pages/AuditLogPage'));
const SettingsPage               = lazy(() => import('@/pages/SettingsPage'));
const BrandingPage               = lazy(() => import('@/pages/BrandingPage'));
const HelpPage                   = lazy(() => import('@/pages/HelpPage'));
const HelpTrainingPage           = lazy(() => import('@/pages/HelpTrainingPage'));
const RoadmapPage                = lazy(() => import('@/pages/RoadmapPage'));

// Quiet placeholder shown for the millisecond or two between route
// click and the lazy chunk arriving. A SkeletonRows-style block
// would be more polished but each page already renders its own
// skeleton on data load — a tiny "Loading…" line here keeps the
// inter-route gap from flashing the dashboard background.
function PageFallback() {
  return <Spinner label="Loading…" style={{ padding: '24px 16px', color: 'var(--color-text-muted)' }} />;
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/oidc-complete" element={<OidcCompletePage />} />
        <Route element={<BreadcrumbProvider><Layout /></BreadcrumbProvider>}>
          <Route path="/" element={<DashboardPage />} />
          {/* Get Started was removed; keep the old /setup link working. */}
          <Route path="/setup" element={<Navigate to="/" replace />} />
          <Route path="/processes" element={<ProcessCatalogPage />} />
          <Route path="/processes/wizard" element={<ValueStreamWizard />} />
          <Route path="/processes/visualization" element={<ProcessVisualizationPage />} />
          <Route path="/processes/data-map" element={<ProcessDataMapPage />} />
          <Route path="/processes/compare" element={<ComparisonPage />} />
          {/* Combined pages */}
          <Route path="/systems-and-data" element={<SystemsAndDataPage />} />
          <Route path="/governance" element={<Navigate to="/governance-groups" replace />} />
          <Route path="/analyze" element={<AnalyzePage />} />
          {/* Legacy routes — kept for backward compatibility and deep links */}
          <Route path="/data-assets" element={<DataAssetsHubPage />} />
          {/* Orphan Assets folded into Data Assets as the "Unmapped" mapping
              filter. Redirect preserves old links (digest, AI, bookmarks). */}
          <Route path="/data-assets/orphans" element={<Navigate to="/data-assets?mapping=unmapped" replace />} />
          {/* Quality-rule detail page — the Rules tab opens a record here, the
              same way the Registry tab opens an asset at /data-assets/:id. The
              bare /rules path redirects to the hub's Rules tab so the breadcrumb
              trail links back up. */}
          <Route path="/data-assets/rules" element={<Navigate to="/data-assets?tab=rules" replace />} />
          <Route path="/data-assets/rules/:id" element={<DataQualityRuleDetailPage />} />
          <Route path="/data-assets/:id" element={<DataAssetDetailPage />} />
          <Route path="/systems" element={<SystemsHubPage />} />
          <Route path="/systems/:id" element={<SystemDetailPage />} />
          {/* Data Mapping folded into the Process ↔ Data map as its Table
              view. Redirect preserves old links (dashboard, deep links). */}
          <Route path="/mappings" element={<Navigate to="/processes/data-map?view=table" replace />} />
          <Route path="/gap-detection" element={<GapDetectionPage />} />
          <Route path="/organizations" element={<OrganizationsPage />} />
          <Route path="/organizations/visualization" element={<OrgVisualizationPage />} />
          <Route path="/organizations/:id" element={<OrganizationDetailPage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/people/:id" element={<PersonDetailPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:id" element={<AgentDetailPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/skills/:id" element={<SkillDetailPage />} />
          <Route path="/governance-groups" element={<GovernanceGroupsPage />} />
          <Route path="/governance-groups/:id" element={<GovernanceGroupDetailPage />} />
          <Route path="/governance/visualization" element={<GovernanceVisualizationPage />} />
          <Route path="/data-domains" element={<DataDomainsPage />} />
          {/* Merged surfaces — option B of the governance IA cleanup */}
          <Route path="/documentation" element={<DocumentationPage />} />
          <Route path="/operations-manual" element={<Navigate to="/documentation?tab=manual" replace />} />
          <Route path="/sops" element={<Navigate to="/documentation?tab=procedures" replace />} />
          <Route path="/dama-roles" element={<RolesPage />} />
          <Route path="/dama-roles/:roleType" element={<GovernanceRoleDetailPage />} />
          <Route path="/roles" element={<Navigate to="/dama-roles" replace />} />
          <Route path="/raci" element={<Navigate to="/dama-roles?tab=raci" replace />} />
          <Route path="/control-tower" element={<Navigate to="/enterprise-view" replace />} />
          {/* The Governance Maturity Scorecard tab was removed; its data still
              surfaces in the Executive Report. Old /scorecard links → Reports. */}
          <Route path="/scorecard" element={<Navigate to="/reports" replace />} />
          <Route path="/report" element={<Navigate to="/reports" replace />} />
          <Route path="/data-lineage" element={<DataLineagePage />} />
          {/* Data Quality folded into the Data Assets hub as the Quality /
              Rules tabs. Redirect preserves old links (digest, AI, bookmarks). */}
          <Route path="/data-quality" element={<Navigate to="/data-assets?tab=quality" replace />} />
          {/* Connections folded into the Systems hub as its second tab.
              Redirect preserves old links (Settings connector panel, bookmarks). */}
          <Route path="/connections" element={<Navigate to="/systems?tab=connections" replace />} />
          <Route path="/connections/:id" element={<ConnectionDetailPage />} />
          <Route path="/governance-work" element={<GovernanceWorkPage />} />
          <Route path="/governance-work/tasks/:id" element={<GovernanceTaskDetailPage />} />
          <Route path="/governance-work/issues/:id" element={<GovernanceIssueDetailPage />} />
          <Route path="/governance-policies" element={<GovernancePoliciesPage />} />
          <Route path="/governance-policies/:id" element={<GovernanceDocumentDetailPage />} />
          <Route path="/governance-documents/:id" element={<GovernanceDocumentDetailPage />} />
          {/* Canonical alias — the page now covers Charter / Framework /
              Standard / Policy, so the broader URL reads honestly. The
              /governance-policies path is kept indefinitely as a
              back-compat alias since existing deep links and the
              sidebar still point at it. */}
          <Route path="/governance-documents" element={<GovernancePoliciesPage />} />
          <Route path="/governance-calendar" element={<GovernanceCalendarPage />} />
          <Route path="/decision-rights" element={<DecisionRightsPage />} />
          <Route path="/decision-rights/:id" element={<DecisionRightDetailPage />} />
          <Route path="/business-glossary" element={<BusinessGlossaryPage />} />
          <Route path="/business-glossary/:id" element={<GlossaryTermDetailPage />} />
          {/* The program has no page of its own — its scope, principles, and
              operating model live on Governance → Foundation. (The former
              phase tracker / lifecycle were retired with Get Started.) */}
          <Route path="/governance-program" element={<Navigate to="/governance/foundation" replace />} />
          <Route path="/governance/foundation" element={<GovernanceFoundationPage />} />
          <Route path="/enterprise-view" element={<EnterpriseViewPage />} />
          <Route path="/analysis" element={<AnalysisPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/:id" element={<ReportDetailPage />} />
          {/* The Council Dashboard + Scorecard are now one page. Old links redirect. */}
          <Route path="/council" element={<CouncilPage />} />
          <Route path="/council-dashboard" element={<Navigate to="/council" replace />} />
          <Route path="/council-scorecard" element={<Navigate to="/council" replace />} />
          <Route path="/governance-exceptions" element={<GovernanceExceptionsPage />} />
          <Route path="/reports/builder" element={<ReportBuilderPage />} />
          <Route path="/reports/builder/:id" element={<ReportBuilderPage />} />
          <Route path="/audit-log" element={<AuditLogPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/branding" element={<BrandingPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/help/training" element={<HelpTrainingPage />} />
          <Route path="/roadmap" element={<RoadmapPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
