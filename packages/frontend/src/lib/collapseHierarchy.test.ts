import { describe, it, expect } from 'vitest';
import {
  collapseProcessHierarchy,
  availableLevels,
  collapseBranch,
  type HNode,
  type HEdge,
} from './collapseHierarchy';

// A tiny fixture: one value stream → one process → two activities. One activity
// maps to a data asset (hosted by a system).
//   VS ──contains── P ──contains── A1 ──uses──▶ DA ──hosted-by──▶ SYS
//                     └─contains── A2
const proc = (id: string, level: string, label = id): HNode => ({ id, type: 'process', label, status: 'active', meta: { level } });
const asset = (id: string): HNode => ({ id, type: 'data-asset', label: id, meta: {} });
const system = (id: string): HNode => ({ id, type: 'system', label: id, meta: {} });

const NODES: HNode[] = [
  proc('vs', 'VALUE_STREAM'),
  proc('p', 'PROCESS'),
  proc('a1', 'ACTIVITY'),
  proc('a2', 'ACTIVITY'),
  asset('da'),
  system('sys'),
];
const EDGES: HEdge[] = [
  { id: 'h1', source: 'vs', target: 'p', type: 'hierarchy', label: 'contains' },
  { id: 'h2', source: 'p', target: 'a1', type: 'hierarchy', label: 'contains' },
  { id: 'h3', source: 'p', target: 'a2', type: 'hierarchy', label: 'contains' },
  { id: 'm1', source: 'a1', target: 'da', type: 'mapping', label: 'uses' },
  { id: 'hb', source: 'da', target: 'sys', type: 'hosted-by', label: 'hosted by' },
];

describe('collapseProcessHierarchy', () => {
  it('at ACTIVITY depth shows the whole tree unchanged', () => {
    const r = collapseProcessHierarchy(NODES, EDGES, 'ACTIVITY', new Set());
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a1', 'a2', 'da', 'p', 'sys', 'vs']);
    // The activity→asset mapping stays on the activity.
    expect(r.edges.find((e) => e.type === 'mapping')).toMatchObject({ source: 'a1', target: 'da' });
  });

  it('at PROCESS depth hides activities and rolls their mappings up to the process', () => {
    const r = collapseProcessHierarchy(NODES, EDGES, 'PROCESS', new Set());
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['da', 'p', 'sys', 'vs']);
    // The mapping is re-anchored a1 → p.
    const mapping = r.edges.find((e) => e.type === 'mapping');
    expect(mapping).toMatchObject({ source: 'p', target: 'da' });
    // Data asset still hosted by system.
    expect(r.edges.find((e) => e.type === 'hosted-by')).toMatchObject({ source: 'da', target: 'sys' });
    // The VS→P hierarchy edge survives; edges to hidden activities are gone.
    expect(r.edges.filter((e) => e.type === 'hierarchy').map((e) => e.id)).toEqual(['h1']);
  });

  it('at VALUE_STREAM depth rolls everything up to the value stream', () => {
    const r = collapseProcessHierarchy(NODES, EDGES, 'VALUE_STREAM', new Set());
    expect(r.nodes.filter((n) => n.type === 'process').map((n) => n.id)).toEqual(['vs']);
    expect(r.edges.find((e) => e.type === 'mapping')).toMatchObject({ source: 'vs', target: 'da' });
  });

  it('dedupes rolled-up edges when two activities map to the same asset', () => {
    const nodes = [...NODES];
    const edges = [...EDGES, { id: 'm2', source: 'a2', target: 'da', type: 'mapping', label: 'uses' }];
    const r = collapseProcessHierarchy(nodes, edges, 'PROCESS', new Set());
    // Both a1→da and a2→da collapse to p→da — only one edge remains.
    expect(r.edges.filter((e) => e.type === 'mapping')).toHaveLength(1);
  });

  it('expands one branch while the rest stay collapsed', () => {
    const r = collapseProcessHierarchy(NODES, EDGES, 'PROCESS', new Set(['p']));
    // p is expanded → its activities reappear.
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a1', 'a2', 'da', 'p', 'sys', 'vs']);
    // The mapping is back on the activity, not rolled up.
    expect(r.edges.find((e) => e.type === 'mapping')).toMatchObject({ source: 'a1', target: 'da' });
  });

  it('reports an expand control on a process with hidden children', () => {
    const r = collapseProcessHierarchy(NODES, EDGES, 'PROCESS', new Set());
    expect(r.expandControls.get('p')).toEqual({ state: 'expand', count: 2, childLevel: 'ACTIVITY' });
    // vs has one visible child (p) at PROCESS depth → collapse affordance.
    expect(r.expandControls.get('vs')).toEqual({ state: 'collapse', count: 1, childLevel: 'PROCESS' });
  });

  it('reports a collapse control on an expanded process', () => {
    const r = collapseProcessHierarchy(NODES, EDGES, 'PROCESS', new Set(['p']));
    expect(r.expandControls.get('p')).toEqual({ state: 'collapse', count: 2, childLevel: 'ACTIVITY' });
  });

  it('drops no non-process nodes regardless of depth', () => {
    for (const lvl of ['VALUE_STREAM', 'PROCESS', 'ACTIVITY'] as const) {
      const r = collapseProcessHierarchy(NODES, EDGES, lvl, new Set());
      expect(r.nodes.some((n) => n.id === 'da')).toBe(true);
      expect(r.nodes.some((n) => n.id === 'sys')).toBe(true);
    }
  });
});

describe('availableLevels', () => {
  it('returns only levels present, in hierarchy order', () => {
    expect(availableLevels(NODES)).toEqual(['VALUE_STREAM', 'PROCESS', 'ACTIVITY']);
  });
  it('omits sub-process when absent', () => {
    expect(availableLevels(NODES)).not.toContain('SUBPROCESS');
  });
});

describe('collapseBranch', () => {
  it('removes the id and its descendants from the expanded set', () => {
    const expanded = new Set(['vs', 'p']);
    const next = collapseBranch(expanded, 'vs', EDGES);
    // vs and its descendant p both dropped.
    expect(next.has('vs')).toBe(false);
    expect(next.has('p')).toBe(false);
  });
  it('leaves unrelated expansions intact', () => {
    const expanded = new Set(['p', 'other']);
    const next = collapseBranch(expanded, 'p', EDGES);
    expect(next.has('p')).toBe(false);
    expect(next.has('other')).toBe(true);
  });
});
