import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../../api/client';
import { useToastStore } from '../../stores/toastStore';

// ── Dependencies Panel — activity-level predecessors (what has to
//    happen before this) and successors (what this unblocks). Backed
//    by the FlowRelationship table (SEQUENCE / PARALLEL / CONDITIONAL
//    / LOOP). The backend rejects cycles (unless the caller explicitly
//    asks for a LOOP) and enforces uniqueness per (from, to, type).
//    Panel keeps its own copy of the flows to avoid re-shuffling the
//    parent tree's state every time a user wires an edge.

interface DependencyOtherEnd {
  id: string;
  name: string;
  level: string;
  status: string;
  breadcrumb: string;
}
interface DependencyFlow {
  id: string;
  type: 'SEQUENCE' | 'PARALLEL' | 'CONDITIONAL' | 'LOOP';
  label: string | null;
  condition: string | null;
  other: DependencyOtherEnd | null;
}

function DependenciesPanel({ nodeId, valueStreamName, allActivities, disabled }: {
  nodeId: string;
  /** Value-stream name for this activity — used to detect cross-stream
   *  picks in the "add" dropdown so we can flag them with a warning
   *  chip (cross-stream deps are legal but usually a wrong pick). */
  valueStreamName: string | null;
  allActivities: Array<{ id: string; name: string; valueStreamName: string }>;
  disabled: boolean;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const onToast = useCallback(
    (kind: 'error' | 'success' | 'info', msg: string) => addToast(kind, msg),
    [addToast],
  );
  const [predecessors, setPredecessors] = useState<DependencyFlow[]>([]);
  const [successors, setSuccessors] = useState<DependencyFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingPred, setAddingPred] = useState<string>('');
  const [addingSucc, setAddingSucc] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: { outgoing: DependencyFlow[]; incoming: DependencyFlow[] } }>(
        `/process-catalog/flows/by-node/${nodeId}`,
      );
      setPredecessors(res.data?.incoming || []);
      setSuccessors(res.data?.outgoing || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [nodeId]);

  useEffect(() => { load(); }, [load]);

  const thisValueStream = valueStreamName;

  const addFlow = async (otherId: string, direction: 'predecessor' | 'successor') => {
    if (!otherId) return;
    const fromNodeId = direction === 'predecessor' ? otherId : nodeId;
    const toNodeId = direction === 'predecessor' ? nodeId : otherId;
    try {
      await apiClient.post('/process-catalog/flows', { fromNodeId, toNodeId, type: 'SEQUENCE' });
      onToast('success', direction === 'predecessor' ? 'Predecessor added' : 'Successor added');
      if (direction === 'predecessor') setAddingPred(''); else setAddingSucc('');
      await load();
    } catch (e) {
      // The backend surfaces the specific reason (cycle / duplicate /
      // self-ref) — pass it through so the user sees WHY the pick was
      // rejected rather than a generic "failed to add".
      onToast('error', e instanceof Error ? e.message : 'Could not add dependency');
    }
  };

  const removeFlow = async (flowId: string) => {
    try {
      await apiClient.delete(`/process-catalog/flows/${flowId}`);
      onToast('info', 'Dependency removed');
      await load();
    } catch (e) {
      onToast('error', e instanceof Error ? e.message : 'Could not remove');
    }
  };

  // Filter the picker's options: only ACTIVITY-level nodes that aren't
  // this one, and that aren't already wired in the chosen direction.
  const usedForPred = new Set(predecessors.map((f) => f.other?.id).filter(Boolean) as string[]);
  const usedForSucc = new Set(successors.map((f) => f.other?.id).filter(Boolean) as string[]);
  const optionsForPred = allActivities.filter((a) => a.id !== nodeId && !usedForPred.has(a.id));
  const optionsForSucc = allActivities.filter((a) => a.id !== nodeId && !usedForSucc.has(a.id));

  const renderRow = (flow: DependencyFlow) => {
    if (!flow.other) {
      return (
        <div key={flow.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 11 }}>
          <span style={{ color: '#92400e' }}>Dangling reference (target deleted)</span>
          {!disabled && (
            <button onClick={() => removeFlow(flow.id)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontSize: 11 }}>Remove</button>
          )}
        </div>
      );
    }
    const otherStream = allActivities.find((a) => a.id === flow.other!.id)?.valueStreamName;
    const crossStream = !!(thisValueStream && otherStream && otherStream !== thisValueStream);
    return (
      <div key={flow.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 11 }}>
        <span style={{ fontWeight: 500 }}>{flow.other.name}</span>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>{flow.other.breadcrumb}</span>
        {crossStream && (
          <span title="Different value stream from this activity" style={{ background: '#fef3c7', color: '#92400e', padding: '0 4px', borderRadius: 2, fontSize: 9, fontWeight: 600 }}>CROSS-STREAM</span>
        )}
        {flow.type !== 'SEQUENCE' && (
          <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '0 4px', borderRadius: 2, fontSize: 9, fontWeight: 600 }}>{flow.type}</span>
        )}
        {!disabled && (
          <button onClick={() => removeFlow(flow.id)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11 }} title="Remove dependency">×</button>
        )}
      </div>
    );
  };

  if (loading) return null;
  // Hide the whole panel when disabled AND empty — no useful signal.
  if (disabled && predecessors.length === 0 && successors.length === 0) return null;

  return (
    <div style={{ marginTop: 12, padding: '10px 12px', background: '#fafbfc', border: '1px solid var(--color-border)', borderRadius: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Dependencies</span>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>· what has to run before, and what this unblocks</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Predecessors */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4 }}>Predecessors ({predecessors.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {predecessors.length === 0 && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>None</div>}
            {predecessors.map(renderRow)}
          </div>
          {!disabled && optionsForPred.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <select
                value={addingPred}
                onChange={(e) => setAddingPred(e.target.value)}
                style={{ flex: 1, fontSize: 11, padding: '3px 6px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)' }}
              >
                <option value="">+ Add predecessor…</option>
                {optionsForPred.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.valueStreamName})</option>
                ))}
              </select>
              <button
                onClick={() => addFlow(addingPred, 'predecessor')}
                disabled={!addingPred}
                style={{ padding: '3px 8px', fontSize: 11, background: addingPred ? 'var(--color-primary)' : 'var(--color-bg)', color: addingPred ? '#fff' : 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: addingPred ? 'pointer' : 'not-allowed' }}
              >Add</button>
            </div>
          )}
        </div>
        {/* Successors */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4 }}>Successors ({successors.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {successors.length === 0 && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>None</div>}
            {successors.map(renderRow)}
          </div>
          {!disabled && optionsForSucc.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <select
                value={addingSucc}
                onChange={(e) => setAddingSucc(e.target.value)}
                style={{ flex: 1, fontSize: 11, padding: '3px 6px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)' }}
              >
                <option value="">+ Add successor…</option>
                {optionsForSucc.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.valueStreamName})</option>
                ))}
              </select>
              <button
                onClick={() => addFlow(addingSucc, 'successor')}
                disabled={!addingSucc}
                style={{ padding: '3px 8px', fontSize: 11, background: addingSucc ? 'var(--color-primary)' : 'var(--color-bg)', color: addingSucc ? '#fff' : 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: addingSucc ? 'pointer' : 'not-allowed' }}
              >Add</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DependenciesPanel;
