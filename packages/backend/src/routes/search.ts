import { Router, Request, Response } from 'express';
import { processNodes } from './process-catalog';
import { systems } from './systems';
import { dataAssets } from './data-assets';
import { organizations } from './organizations';
import { people } from './people';

const router = Router();

interface SearchResult {
  type: 'process' | 'system' | 'data-asset' | 'organization' | 'person';
  id: string;
  name: string;
  description: string;
  meta: Record<string, string>;
}

/** GET /api/v1/search?q=query */
router.get('/', (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim().toLowerCase();

  if (!q) {
    res.json({ success: true, data: { results: [] } });
    return;
  }

  const results: SearchResult[] = [];

  // Search process nodes
  for (const node of processNodes) {
    if (results.length >= 20) break;
    if (
      node.name.toLowerCase().includes(q) ||
      node.description.toLowerCase().includes(q)
    ) {
      results.push({
        type: 'process',
        id: node.id,
        name: node.name,
        description: node.description,
        meta: { level: node.level, status: node.status },
      });
    }
  }

  // Search systems
  for (const sys of systems) {
    if (results.length >= 20) break;
    if (
      sys.name.toLowerCase().includes(q) ||
      sys.description.toLowerCase().includes(q)
    ) {
      results.push({
        type: 'system',
        id: sys.id,
        name: sys.name,
        description: sys.description,
        meta: { systemType: sys.systemType },
      });
    }
  }

  // Search data assets
  for (const asset of dataAssets) {
    if (results.length >= 20) break;
    if (
      asset.name.toLowerCase().includes(q) ||
      asset.description.toLowerCase().includes(q)
    ) {
      results.push({
        type: 'data-asset',
        id: asset.id,
        name: asset.name,
        description: asset.description,
        meta: { governanceTier: asset.governanceTier },
      });
    }
  }

  // Search organizations
  for (const org of organizations) {
    if (results.length >= 20) break;
    if (
      org.name.toLowerCase().includes(q) ||
      org.description.toLowerCase().includes(q)
    ) {
      results.push({
        type: 'organization',
        id: org.id,
        name: org.name,
        description: org.description,
        meta: { type: org.type, industry: org.industry },
      });
    }
  }

  // Search people
  for (const person of people) {
    if (results.length >= 20) break;
    if (
      person.name.toLowerCase().includes(q) ||
      person.email.toLowerCase().includes(q)
    ) {
      results.push({
        type: 'person',
        id: person.id,
        name: person.name,
        description: person.email,
        meta: { role: person.role, title: person.title },
      });
    }
  }

  // Trim to 20 in case we went over
  res.json({ success: true, data: { results: results.slice(0, 20) } });
});

export default router;
