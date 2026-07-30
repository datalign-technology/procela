// dbt manifest source adapter. Reads a dbt `manifest.json` off disk
// (produced by `dbt compile` / `dbt run`) and maps its materialised
// nodes — models, sources, seeds, snapshots — into ReportedAssets with
// their columns. No database connection and no network to dbt; the
// customer's own dbt run produced the file.
//
// Asset identity ("schema.relation") matches the backend reconciler's
// friendlyAssetName (routes/data-lineage) so a manifest shipped by the
// edge agent reconciles with the same asset an in-app dbt import or a
// live DB scan would produce. Lineage + dbt tests are the richer
// in-app import's job (that path has the user-JWT surface the reconciler
// needs); the edge source captures models + columns.

import { readFileSync } from 'fs';
import type { DbtSource, ReportedAsset, ReportedColumn } from './types';

// Resource types that materialise into a warehouse relation we surface
// as an asset — same set the backend reconciler uses. Tests / analyses /
// operations are not assets in Procela's sense.
const DBT_ASSET_TYPES = new Set(['model', 'source', 'seed', 'snapshot']);

interface DbtColumn {
  name?: string;
  data_type?: string | null;
  description?: string;
}

interface DbtNode {
  resource_type?: string;
  name?: string;
  schema?: string | null;
  identifier?: string; // sources: the physical table name
  description?: string;
  columns?: Record<string, DbtColumn>;
}

export interface DbtManifest {
  nodes?: Record<string, DbtNode>;
  sources?: Record<string, DbtNode>;
}

/** "schema.relation" asset identity. For a source, dbt's identifier is
 *  the physical table; for a model it's the model name. Mirrors the
 *  backend's friendlyAssetName so identities line up across ingest paths. */
export function dbtAssetName(node: DbtNode): string {
  const schema = (node.schema || '').trim();
  const base = (node.identifier || node.name || '').trim();
  return schema ? `${schema}.${base}` : base;
}

function dbtColumns(node: DbtNode): ReportedColumn[] | undefined {
  if (!node.columns) return undefined;
  const mapped: ReportedColumn[] = [];
  // dbt manifest columns are an ordered object; use insertion order as
  // the ordinal. dbt doesn't carry nullability, so we leave it unset.
  Object.values(node.columns).forEach((c, i) => {
    const name = (c?.name || '').trim();
    if (!name) return;
    mapped.push({ name, dataType: c.data_type || undefined, ordinal: i + 1 });
  });
  return mapped.length ? mapped : undefined;
}

/** Map a parsed dbt manifest object into ReportedAssets. Pure — scanDbt
 *  reads the file, this does the mapping so it's unit-testable. No row
 *  counts or freshness: a manifest is static compile metadata. */
export function parseDbtManifest(manifest: DbtManifest, systemId?: string): ReportedAsset[] {
  const assets: ReportedAsset[] = [];
  for (const group of [manifest?.nodes, manifest?.sources]) {
    if (!group) continue;
    for (const node of Object.values(group)) {
      if (!node || !node.resource_type || !DBT_ASSET_TYPES.has(node.resource_type)) continue;
      const name = dbtAssetName(node);
      if (!name) continue;
      const columns = dbtColumns(node);
      assets.push({
        name,
        systemId,
        description: node.description || `dbt ${node.resource_type} ${name}`,
        ...(columns ? { columns } : {}),
      });
    }
  }
  return assets;
}

/** Scan one dbt source — read manifest.json off disk and map it. Errors
 *  propagate so the caller logs a SCAN_FAILED for this source. */
export async function scanDbt(source: DbtSource): Promise<ReportedAsset[]> {
  const raw = readFileSync(source.manifestPath, 'utf-8');
  let manifest: DbtManifest;
  try {
    manifest = JSON.parse(raw) as DbtManifest;
  } catch (err) {
    throw new Error(`dbt manifest at ${source.manifestPath} is not valid JSON: ${(err as Error).message}`);
  }
  return parseDbtManifest(manifest, source.systemId);
}
