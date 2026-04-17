import { Router, Request, Response } from 'express';
import { processNodes } from './process-catalog';
import { dataAssets } from './data-assets';
import { systems } from './systems';
import { people } from './people';
import { dataDomains } from './data-domains';
import { dataLineageLinks } from './data-lineage';
import { dataQualityRules } from './data-quality';

const router = Router();

interface GraphNode {
  id: string;
  type: 'process' | 'system' | 'data-asset' | 'person' | 'domain';
  label: string;
  status?: string;
  meta: Record<string, any>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
}

router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (n: GraphNode) => {
    if (!nodeIds.has(n.id)) { nodeIds.add(n.id); nodes.push(n); }
  };

  // Process nodes (top 3 levels: VALUE_STREAM, PROCESS, ACTIVITY)
  const topLevels = new Set(['VALUE_STREAM', 'PROCESS', 'ACTIVITY']);
  const filteredProcesses = orgId
    ? processNodes.filter((p) => p.orgId === orgId || p.orgIds?.includes(orgId as string))
    : processNodes;
  for (const p of filteredProcesses) {
    if (!topLevels.has(p.level)) continue;
    addNode({
      id: p.id, type: 'process',
      label: p.name, status: p.status,
      meta: { level: p.level, description: p.description, ownerId: p.ownerId },
    });
    if (p.parentId && nodeIds.has(p.parentId)) {
      edges.push({ id: `ph-${p.id}`, source: p.parentId, target: p.id, type: 'hierarchy', label: 'contains' });
    }
  }
  // Second pass for parent edges (parent may be added after child)
  for (const p of filteredProcesses) {
    if (!topLevels.has(p.level) || !p.parentId) continue;
    if (nodeIds.has(p.parentId) && !edges.some((e) => e.id === `ph-${p.id}`)) {
      edges.push({ id: `ph-${p.id}`, source: p.parentId, target: p.id, type: 'hierarchy', label: 'contains' });
    }
  }

  // Systems
  const filteredSystems = orgId
    ? systems.filter((s: any) => s.orgId === orgId) : systems;
  for (const s of filteredSystems as any[]) {
    addNode({
      id: s.id, type: 'system',
      label: s.name, status: undefined,
      meta: { systemType: s.systemType, description: s.description },
    });
  }

  // Data assets
  const filteredAssets = orgId
    ? dataAssets.filter((a) => a.orgId === orgId) : dataAssets;
  for (const a of filteredAssets) {
    const assetRules = dataQualityRules.filter((r) => r.dataAssetId === a.id);
    addNode({
      id: a.id, type: 'data-asset',
      label: a.name, status: undefined,
      meta: {
        governanceTier: a.governanceTier,
        healthScore: a.healthScore,
        systemId: a.systemId,
        rulesCount: assetRules.length,
        description: a.description,
      },
    });
    // Asset → System edge
    if (a.systemId && nodeIds.has(a.systemId)) {
      edges.push({ id: `as-${a.id}`, source: a.id, target: a.systemId, type: 'hosted-by', label: 'hosted by' });
    }
  }

  // Data domains
  const filteredDomains = orgId
    ? dataDomains.filter((d) => d.orgId === orgId) : dataDomains;
  for (const d of filteredDomains) {
    addNode({
      id: d.id, type: 'domain',
      label: d.name, status: d.status,
      meta: { description: d.description, assetCount: d.dataAssetIds.length },
    });
    // Domain → Assets edges
    for (const aid of d.dataAssetIds) {
      if (nodeIds.has(aid)) {
        edges.push({ id: `da-${d.id}-${aid}`, source: d.id, target: aid, type: 'governs', label: 'governs' });
      }
    }
  }

  // People (only those who own/steward something to keep graph manageable)
  const relevantPeopleIds = new Set<string>();
  for (const p of filteredProcesses) { if (p.ownerId) relevantPeopleIds.add(p.ownerId); }
  for (const a of filteredAssets) {
    if (a.owner) relevantPeopleIds.add(a.owner);
    for (const sid of a.stewardIds || []) relevantPeopleIds.add(sid);
  }
  for (const d of filteredDomains) {
    if (d.ownerId) relevantPeopleIds.add(d.ownerId);
    for (const sid of d.stewardIds) relevantPeopleIds.add(sid);
  }
  for (const pid of relevantPeopleIds) {
    const person = people.find((p) => p.id === pid);
    if (!person) continue;
    addNode({
      id: person.id, type: 'person',
      label: person.name, status: undefined,
      meta: { email: person.email, role: person.role, title: person.title },
    });
  }

  // Ownership edges: Process → Person
  for (const p of filteredProcesses) {
    if (p.ownerId && nodeIds.has(p.ownerId) && topLevels.has(p.level)) {
      edges.push({ id: `po-${p.id}`, source: p.id, target: p.ownerId, type: 'owned-by', label: 'owned by' });
    }
  }
  // Ownership edges: Asset → Person
  for (const a of filteredAssets) {
    if (a.owner && nodeIds.has(a.owner)) {
      edges.push({ id: `ao-${a.id}`, source: a.id, target: a.owner, type: 'owned-by', label: 'owned by' });
    }
  }
  // Ownership edges: Domain → Person
  for (const d of filteredDomains) {
    if (d.ownerId && nodeIds.has(d.ownerId)) {
      edges.push({ id: `do-${d.id}`, source: d.id, target: d.ownerId, type: 'owned-by', label: 'owned by' });
    }
  }

  // Mappings: Process step → Data Asset (load inline to avoid circular deps)
  let mappings: any[] = [];
  try { mappings = require('./mappings').mappings || []; } catch { /* */ }
  const filteredMappings = orgId
    ? mappings.filter((m: any) => m.orgId === orgId) : mappings;
  for (const m of filteredMappings) {
    // Map to the process node (step/activity) and data asset
    if (nodeIds.has(m.processStepId) && nodeIds.has(m.dataAssetId)) {
      edges.push({
        id: `m-${m.id}`,
        source: m.processStepId,
        target: m.dataAssetId,
        type: 'mapping',
        label: m.linkType || 'uses',
      });
    }
  }

  // Lineage: System → System
  const filteredLineage = orgId
    ? dataLineageLinks.filter((l: any) => l.orgId === orgId) : dataLineageLinks;
  for (const l of filteredLineage as any[]) {
    if (nodeIds.has(l.sourceSystemId) && nodeIds.has(l.targetSystemId)) {
      edges.push({
        id: `lin-${l.id}`,
        source: l.sourceSystemId,
        target: l.targetSystemId,
        type: 'lineage',
        label: l.transformationType || 'feeds',
      });
    }
  }

  res.json({
    success: true,
    data: { nodes, edges },
    summary: {
      processes: nodes.filter((n) => n.type === 'process').length,
      systems: nodes.filter((n) => n.type === 'system').length,
      dataAssets: nodes.filter((n) => n.type === 'data-asset').length,
      domains: nodes.filter((n) => n.type === 'domain').length,
      people: nodes.filter((n) => n.type === 'person').length,
      edges: edges.length,
    },
  });
});

export default router;
