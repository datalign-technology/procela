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
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
      </Route>
    </Routes>
  );
}
