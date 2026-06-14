import { Router, Request, Response } from 'express';
import { getCatalog, getEntity, listEntities } from '../services/data-model';

// ──────────────────────────────────────────────────────────────────────────
// /api/v1/data-model — Logical Data Model metadata
//
// Read-only endpoint that exposes the LDM catalog. Two consumers today:
//
//   - The Report Builder UI (Phase 2 of this feature) — queries
//     /data-model to populate its entity / field / relationship pickers.
//   - The /data-model/:id detail route — used by the Report Builder when
//     a user picks a primary entity and the UI needs the full field list
//     plus its join graph.
//
// Future consumers (Phase 3):
//   - OData v4 endpoint generator
//   - Postgres view generator (once the persistence layer migrates)
//
// The catalog itself lives in services/data-model.ts as pure data, so
// the same source of truth feeds in-app UI, BI views, and external API.
// ──────────────────────────────────────────────────────────────────────────

const router = Router();

/** GET /api/v1/data-model — the whole LDM catalog. */
router.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, data: getCatalog() });
});

/** GET /api/v1/data-model/entities — just the entity summaries
 *  (no fields / relationships). Useful for the entity picker. */
router.get('/entities', (_req: Request, res: Response) => {
  const entities = listEntities().map((e) => ({
    id: e.id,
    label: e.label,
    singular: e.singular,
    description: e.description,
    fieldCount: e.fields.length,
    relationshipCount: e.relationships.length,
  }));
  res.json({ success: true, data: entities });
});

/** GET /api/v1/data-model/entities/:id — full detail for one entity. */
router.get('/entities/:id', (req: Request, res: Response) => {
  const entity = getEntity(String(req.params.id));
  if (!entity) {
    res.status(404).json({ success: false, error: 'Entity not found in the LDM' });
    return;
  }
  res.json({ success: true, data: entity });
});

export default router;
