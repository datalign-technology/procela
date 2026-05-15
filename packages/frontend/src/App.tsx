import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import DashboardPage from '@/pages/DashboardPage';
import LoginPage from '@/pages/LoginPage';
import ProcessCatalogPage from '@/pages/ProcessCatalogPage';
import DataAssetsPage from '@/pages/DataAssetsPage';
import SystemsPage from '@/pages/SystemsPage';
import MappingsPage from '@/pages/MappingsPage';
import SettingsPage from '@/pages/SettingsPage';
import HelpPage from '@/pages/HelpPage';
import ValueStreamWizard from '@/pages/ValueStreamWizard';
import OrganizationsPage from '@/pages/OrganizationsPage';
import OrgVisualizationPage from '@/pages/OrgVisualizationPage';
import PeoplePage from '@/pages/PeoplePage';
import PersonDetailPage from '@/pages/PersonDetailPage';
import AgentsPage from '@/pages/AgentsPage';
import GapDetectionPage from '@/pages/GapDetectionPage';
import GovernanceGroupsPage from '@/pages/GovernanceGroupsPage';
import DataDomainsPage from '@/pages/DataDomainsPage';
import ProcessVisualizationPage from '@/pages/ProcessVisualizationPage';
import GovernanceVisualizationPage from '@/pages/GovernanceVisualizationPage';
import ScorecardPage from '@/pages/ScorecardPage';
import ExecutiveReportPage from '@/pages/ExecutiveReportPage';
import ComparisonPage from '@/pages/ComparisonPage';
import DataLineagePage from '@/pages/DataLineagePage';
import DataQualityPage from '@/pages/DataQualityPage';
import SystemsAndDataPage from '@/pages/SystemsAndDataPage';
import AnalyzePage from '@/pages/AnalyzePage';
import ConnectionsPage from '@/pages/ConnectionsPage';
import ReportsPage from '@/pages/ReportsPage';
import BrandingPage from '@/pages/BrandingPage';
import EnterpriseViewPage from '@/pages/EnterpriseViewPage';
import GovernanceWorkPage from '@/pages/GovernanceWorkPage';
import GovernancePoliciesPage from '@/pages/GovernancePoliciesPage';
import GovernanceProgramPage from '@/pages/GovernanceProgramPage';
import GovernanceCalendarPage from '@/pages/GovernanceCalendarPage';
import DecisionRightsPage from '@/pages/DecisionRightsPage';
import BusinessGlossaryPage from '@/pages/BusinessGlossaryPage';
import DataDictionaryPage from '@/pages/DataDictionaryPage';
import SkillsPage from '@/pages/SkillsPage';
import DocumentationPage from '@/pages/DocumentationPage';
import RolesPage from '@/pages/RolesPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/processes" element={<ProcessCatalogPage />} />
        <Route path="/processes/wizard" element={<ValueStreamWizard />} />
        <Route path="/processes/visualization" element={<ProcessVisualizationPage />} />
        <Route path="/processes/compare" element={<ComparisonPage />} />
        {/* Combined pages */}
        <Route path="/systems-and-data" element={<SystemsAndDataPage />} />
        <Route path="/governance" element={<GovernanceGroupsPage />} />
        <Route path="/analyze" element={<AnalyzePage />} />
        {/* Legacy routes — kept for backward compatibility and deep links */}
        <Route path="/data-assets" element={<DataAssetsPage />} />
        <Route path="/systems" element={<SystemsPage />} />
        <Route path="/mappings" element={<MappingsPage />} />
        <Route path="/gap-detection" element={<GapDetectionPage />} />
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/organizations/visualization" element={<OrgVisualizationPage />} />
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/people/:id" element={<PersonDetailPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/governance-groups" element={<GovernanceGroupsPage />} />
        <Route path="/governance/visualization" element={<GovernanceVisualizationPage />} />
        <Route path="/data-domains" element={<DataDomainsPage />} />
        {/* Merged surfaces — option B of the governance IA cleanup */}
        <Route path="/documentation" element={<DocumentationPage />} />
        <Route path="/operations-manual" element={<Navigate to="/documentation?tab=manual" replace />} />
        <Route path="/sops" element={<Navigate to="/documentation?tab=procedures" replace />} />
        <Route path="/roles" element={<RolesPage />} />
        <Route path="/dama-roles" element={<RolesPage />} />
        <Route path="/raci" element={<Navigate to="/roles?tab=raci" replace />} />
        <Route path="/control-tower" element={<Navigate to="/enterprise-view" replace />} />
        <Route path="/scorecard" element={<ScorecardPage />} />
        <Route path="/report" element={<ExecutiveReportPage />} />
        <Route path="/data-lineage" element={<DataLineagePage />} />
        <Route path="/data-quality" element={<DataQualityPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/governance-work" element={<GovernanceWorkPage />} />
        <Route path="/governance-policies" element={<GovernancePoliciesPage />} />
        <Route path="/governance-calendar" element={<GovernanceCalendarPage />} />
        <Route path="/decision-rights" element={<DecisionRightsPage />} />
        <Route path="/business-glossary" element={<BusinessGlossaryPage />} />
        <Route path="/data-dictionary" element={<DataDictionaryPage />} />
        <Route path="/governance-program" element={<GovernanceProgramPage />} />
        <Route path="/enterprise-view" element={<EnterpriseViewPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/branding" element={<BrandingPage />} />
        <Route path="/help" element={<HelpPage />} />
      </Route>
    </Routes>
  );
}
