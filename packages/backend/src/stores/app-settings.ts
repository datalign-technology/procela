// Shared AppSetting store — the single in-memory backing + repository for the
// generic key-value config table (Postgres) / appSettings.json (dev). All
// consumers of AppSetting (auth config, and — as they migrate — branding and
// AI settings) import this one instance so JSON mode keeps a single source of
// truth. See docs/POSTGRES_CUTOVER_PLAN.md.

import { loadStore, registerStore } from '../lib/persistence';
import { getSettingRepository, type AppSettingRow } from '../db/settings.repo';

export const appSettings: AppSettingRow[] = loadStore<AppSettingRow>('appSettings');
registerStore('appSettings', appSettings);

export const settingsRepo = getSettingRepository(appSettings);
