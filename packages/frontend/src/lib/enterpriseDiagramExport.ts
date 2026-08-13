// Export the Enterprise View graph as a draw.io / diagrams.net file
// (.drawio). draw.io is free, opens the file directly for viewing and
// authoring, and can re-export to Visio (.vsdx) — so this is the
// "Visio or similar, editable" target for the enterprise diagram.
//
// The file is uncompressed mxGraphModel XML wrapped in <mxfile>, which
// diagrams.net reads natively. Nodes are laid out in horizontal
// swimlanes (one per entity type) with wrapped rows, and edges connect
// the node cells by id. draw.io lets the user re-layout freely after
// opening, so the positions here only need to be non-overlapping.

import { download } from './export';

interface ExportNode {
  id: string;
  type: string;
  label: string;
  meta?: Record<string, any>;
}
interface ExportEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}
interface TypeStyle {
  color: string;
  bg: string;
  plural: string;
}

const NODE_W = 160;
const NODE_H = 50;
const GAP_X = 24;
const GAP_Y = 24;
const COLS = 6;
const LABEL_W = 150;
const PAD = 24;
const LANE_GAP = 48;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Same secondary line the on-screen diagram shows under a node's name.
function subtitleOf(n: ExportNode): string {
  const m = n.meta || {};
  return String(m.governanceTier || m.systemType || m.level || m.role || '');
}

// A draw.io cell id must be a stable string; sanitise the entity id so it
// is a safe XML attribute value and matches between vertices and edges.
const cellId = (id: string) => 'n_' + id.replace(/[^a-zA-Z0-9_-]/g, '_');

/** Build an uncompressed .drawio (mxGraphModel) document for the graph. */
export function buildEnterpriseDrawio(
  nodes: ExportNode[],
  edges: ExportEdge[],
  typeConfig: Record<string, TypeStyle>,
  columnOrder: string[],
): string {
  const byType: Record<string, ExportNode[]> = {};
  for (const t of columnOrder) byType[t] = [];
  for (const n of nodes) if (byType[n.type]) byType[n.type].push(n);
  const activeLanes = columnOrder.filter((t) => byType[t]?.length);
  const present = new Set(nodes.map((n) => n.id));

  const cells: string[] = [];
  let y = PAD;
  let maxRight = 0;

  for (const type of activeLanes) {
    const cfg = typeConfig[type] || { color: '#64748b', bg: '#f1f5f9', plural: type };
    const laneNodes = byType[type];
    const rows = Math.max(1, Math.ceil(laneNodes.length / COLS));
    const laneH = rows * NODE_H + (rows - 1) * GAP_Y;
    const usedCols = Math.min(COLS, laneNodes.length);
    const laneW = LABEL_W + usedCols * NODE_W + Math.max(0, usedCols - 1) * GAP_X;
    maxRight = Math.max(maxRight, PAD + laneW + PAD);

    // Lane background band + label (drawn first so nodes sit on top).
    cells.push(
      `<mxCell id="lane_${esc(type)}" value="${esc(cfg.plural.toUpperCase())}" ` +
      `style="rounded=0;whiteSpace=wrap;html=1;fillColor=${cfg.bg};strokeColor=none;opacity=40;` +
      `verticalAlign=top;align=left;fontStyle=1;fontColor=${cfg.color};fontSize=11;spacingLeft=8;spacingTop=6;" ` +
      `vertex="1" parent="1"><mxGeometry x="${PAD}" y="${y - 8}" width="${laneW}" height="${laneH + 16}" as="geometry"/></mxCell>`,
    );

    laneNodes.forEach((n, i) => {
      const r = Math.floor(i / COLS);
      const c = i % COLS;
      const x = PAD + LABEL_W + c * (NODE_W + GAP_X);
      const ny = y + r * (NODE_H + GAP_Y);
      const sub = subtitleOf(n);
      // draw.io stores the label with its HTML entity-escaped inside the
      // value attribute (html=1 then renders it), so build the raw HTML and
      // escape the whole string once — escaping the <br>/<font> markup too.
      const rawLabel = sub
        ? `${n.label}<br><font color="#64748b" style="font-size:10px">${sub}</font>`
        : n.label;
      const value = esc(rawLabel);
      cells.push(
        `<mxCell id="${cellId(n.id)}" value="${value}" ` +
        `style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=${cfg.color};fontColor=#0f172a;fontSize=11;" ` +
        `vertex="1" parent="1"><mxGeometry x="${x}" y="${ny}" width="${NODE_W}" height="${NODE_H}" as="geometry"/></mxCell>`,
      );
    });

    y += laneH + LANE_GAP;
  }

  let ei = 0;
  for (const e of edges) {
    if (!present.has(e.source) || !present.has(e.target)) continue;
    cells.push(
      `<mxCell id="e_${ei++}" value="${esc(e.label || '')}" ` +
      `style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#94a3b8;endArrow=block;fontSize=9;fontColor=#64748b;" ` +
      `edge="1" parent="1" source="${cellId(e.source)}" target="${cellId(e.target)}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    );
  }

  const pageW = Math.max(1200, maxRight);
  const pageH = Math.max(800, y + PAD);
  return [
    '<mxfile host="Procela">',
    '<diagram id="enterprise-view" name="Enterprise View">',
    `<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageW}" pageHeight="${pageH}" math="0" shadow="0">`,
    '<root><mxCell id="0"/><mxCell id="1" parent="0"/>',
    ...cells,
    '</root></mxGraphModel></diagram></mxfile>',
  ].join('');
}

/** Build the .drawio document and trigger a download. */
export function exportEnterpriseDrawio(
  nodes: ExportNode[],
  edges: ExportEdge[],
  typeConfig: Record<string, TypeStyle>,
  columnOrder: string[],
  filenameBase = 'enterprise-view',
): void {
  const xml = buildEnterpriseDrawio(nodes, edges, typeConfig, columnOrder);
  download(`${filenameBase}.drawio`, new Blob([xml], { type: 'application/xml;charset=utf-8' }));
}
