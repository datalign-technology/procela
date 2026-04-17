import { Routes, Route } from 'react-router-dom';
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
import DamaRolesPage from '@/pages/DamaRolesPage';
import ProcessVisualizationPage from '@/pages/ProcessVisualizationPage';
import GovernanceVisualizationPage from '@/pages/GovernanceVisualizationPage';
import ScorecardPage from '@/pages/ScorecardPage';
import ExecutiveReportPage from '@/pages/ExecutiveReportPage';
import ComparisonPage from '@/pages/ComparisonPage';
import RaciMatrixPage from '@/pages/RaciMatrixPage';
import DataLineagePage from '@/pages/DataLineagePage';
import DataQualityPage from '@/pages/DataQualityPage';
import SystemsAndDataPage from '@/pages/SystemsAndDataPage';
import GovernancePage from '@/pages/GovernancePage';
import AnalyzePage from '@/pages/AnalyzePage';
import ConnectionsPage from '@/pages/ConnectionsPage';
import ReportsPage from '@/pages/ReportsPage';
import BrandingPage from '@/pages/BrandingPage';
import EnterpriseViewPage from '@/pages/EnterpriseViewPage';

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
        <Route path="/governance" element={<GovernancePage />} />
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
        <Route path="/governance-groups" element={<GovernanceGroupsPage />} />
        <Route path="/governance/visualization" element={<GovernanceVisualizationPage />} />
        <Route path="/data-domains" element={<DataDomainsPage />} />
        <Route path="/dama-roles" element={<DamaRolesPage />} />
        <Route path="/scorecard" element={<ScorecardPage />} />
        <Route path="/report" element={<ExecutiveReportPage />} />
        <Route path="/raci" element={<RaciMatrixPage />} />
        <Route path="/data-lineage" element={<DataLineagePage />} />
        <Route path="/data-quality" element={<DataQualityPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/enterprise-view" element={<EnterpriseViewPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/branding" element={<BrandingPage />} />
        <Route path="/help" element={<HelpPage />} />
      </Route>
    </Routes>
  );
}
