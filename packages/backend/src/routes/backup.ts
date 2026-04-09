import { Router, Request, Response } from 'express';
import { saveStore } from '../lib/persistence';
import logger from '../lib/logger';

// Import all in-memory stores
import { processNodes, flowRelationships, processVersions } from './process-catalog';
import { systems } from './systems';
import { dataAssets } from './data-assets';
import { organizations } from './organizations';
import { people } from './people';
import { mappings } from './mappings';
import { governanceGroups } from './governance-groups';
import { damaRoles } from './dama-roles';
import { dataDomains } from './data-domains';
import { tags } from './tags';
import { comments } from './comments';

const router = Router();

// All store definitions: key = JSON field name, value = array reference + persistence name
const STORES: Record<string, { data: any[]; persistName: string }> = {
  organizations:      { data: organizations,      persistName: 'organizations' },
  people:             { data: people,              persistName: 'people' },
  processNodes:       { data: processNodes,        persistName: 'processNodes' },
  flowRelationships:  { data: flowRelationships,   persistName: 'flowRelationships' },
  processVersions:    { data: processVersions,     persistName: 'processVersions' },
  systems:            { data: systems,              persistName: 'systems' },
  dataAssets:         { data: dataAssets,           persistName: 'dataAssets' },
  mappings:           { data: mappings,             persistName: 'mappings' },
  governanceGroups:   { data: governanceGroups,     persistName: 'governanceGroups' },
  damaRoles:          { data: damaRoles,            persistName: 'damaRoles' },
  dataDomains:        { data: dataDomains,          persistName: 'dataDomains' },
  tags:               { data: tags,                 persistName: 'tags' },
  comments:           { data: comments,             persistName: 'comments' },
};

/** GET /api/v1/backup/export — Export all data as a single JSON file */
router.get('/export', (_req: Request, res: Response) => {
  const exportData: Record<string, any[]> = {};
  for (const [key, store] of Object.entries(STORES)) {
    exportData[key] = [...store.data];
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    data: exportData,
  };

  logger.info({ counts: Object.fromEntries(Object.entries(exportData).map(([k, v]) => [k, v.length])) }, 'Exported backup');
  res.json(payload);
});

/** POST /api/v1/backup/import — Import data from a backup JSON file (replaces all data) */
router.post('/import', (req: Request, res: Response) => {
  const body = req.body;

  if (!body || !body.data || typeof body.data !== 'object') {
    res.status(400).json({ success: false, error: 'Invalid backup format: missing "data" field' });
    return;
  }

  const imported: Record<string, number> = {};

  for (const [key, store] of Object.entries(STORES)) {
    const incoming = body.data[key];
    if (Array.isArray(incoming)) {
      // Clear existing data
      store.data.splice(0, store.data.length);
      // Push all imported items
      store.data.push(...incoming);
      // Persist to disk
      saveStore(store.persistName, store.data);
      imported[key] = incoming.length;
    } else {
      imported[key] = 0;
    }
  }

  logger.info({ imported }, 'Imported backup');
  res.json({ success: true, imported });
});

export default router;
