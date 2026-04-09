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
import GapDetectionPage from '@/pages/GapDetectionPage';
import GovernanceGroupsPage from '@/pages/GovernanceGroupsPage';
import DataDomainsPage from '@/pages/DataDomainsPage';
import DamaRolesPage from '@/pages/DamaRolesPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/processes" element={<ProcessCatalogPage />} />
        <Route path="/processes/wizard" element={<ValueStreamWizard />} />
        <Route path="/data-assets" element={<DataAssetsPage />} />
        <Route path="/systems" element={<SystemsPage />} />
        <Route path="/mappings" element={<MappingsPage />} />
        <Route path="/gap-detection" element={<GapDetectionPage />} />
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/governance-groups" element={<GovernanceGroupsPage />} />
        <Route path="/data-domains" element={<DataDomainsPage />} />
        <Route path="/dama-roles" element={<DamaRolesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
      </Route>
    </Routes>
  );
}
