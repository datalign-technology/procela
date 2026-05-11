import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useRoleDrawerStore } from '../stores/roleDrawerStore';
import { useOrgContext } from '../stores/orgContext';
import { useTerm } from '../lib/terminology';
import {
  getRoleDef,
  getRoleReference,
  groupsExpectingRole,
  RACI_LABEL,
  RACI_DESCRIPTION,
  RACI_COLOR,
} from '../lib/roleDefinitions';
import { PRIORITY_COLORS } from '../types';

// ──────────────────────────────────────────────────────────────────────────
// RoleDetailDrawer - a slide-in side panel that explains a governance
// role in plain language. Opened by clicking any role chip/label anywhere
// in the app via the roleDrawerStore.
//
// The drawer mixes static reference content (what this role does in
// general, what it typically decides) with dynamic org-specific content
// (who currently holds it in this org). Reference content makes the role
// model learnable; the assignment list makes it concrete.
//
// Lives at the app root (inside Layout) so it overlays every page.
// ──────────────────────────────────────────────────────────────────────────

interface Assignment {
  id: string;
  personId: string;
  personName: string;
  roleType: string;
  scopeId: string;
}

interface SkillRecord {
  id: string;
  name: string;
  category: string;
  description: string;
}

export default function RoleDetailDrawer() {
  const navigate = useNavigate();
  const { activeOrgId } = useOrgContext();
  const roleType = useRoleDrawerStore((s) => s.roleType);
  const close = useRoleDrawerStore((s) => s.close);
  const custodianLabel = useTerm('custodian');

  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  // Skills catalog for the org - used to enrich requiredSkills (names)
  // with the matching skill record (id, category, description). Names
  // that don't match anything in the catalog are still shown, tagged as
  // "not seeded yet" so users know what they're missing.
  const [orgSkills, setOrgSkills] = useState<SkillRecord[]>([]);

  useEffect(() => {
    if (!roleType || !activeOrgId) return;
    let cancelled = false;
    setLoadingAssignments(true);
    Promise.all([
      apiClient.get<{ success: boolean; data: Assignment[] }>(`/dama-roles?orgId=${activeOrgId}`),
      apiClient.get<{ success: boolean; data: SkillRecord[] }>(`/skills?orgId=${activeOrgId}`),
    ])
      .then(([rolesRes, skillsRes]) => {
        if (cancelled) return;
        setAssignments((rolesRes.data || []).filter((a) => a.roleType === roleType));
        setOrgSkills(skillsRes.data || []);
      })
      .catch(() => {
        if (cancelled) return;
        setAssignments([]);
        setOrgSkills([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingAssignments(false);
      });
    return () => { cancelled = true; };
  }, [roleType, activeOrgId]);

  // Close on Escape so the drawer never traps focus.
  useEffect(() => {
    if (!roleType) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [roleType, close]);

  if (!roleType) return null;

  const def = getRoleDef(roleType);
  const ref = getRoleReference(roleType);
  const groups = groupsExpectingRole(roleType);

  // Custodian gets the plain-terminology swap; everything else uses its
  // canonical DAMA label.
  const rawLabel = def?.label ?? roleType;
  const displayLabel = roleType === 'DATA_CUSTODIAN'
    ? rawLabel.replace('Custodian', custodianLabel)
    : rawLabel;

  const priorityColor = def ? PRIORITY_COLORS[def.priority] : null;

  return (
    <>
      <div
        onClick={close}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(15, 23, 42, 0.35)',
          zIndex: 200,
        }}
      />
      <aside
        role="dialog"
        aria-label={`${displayLabel} role details`}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(520px, 95vw)',
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-4px 0 24px rgba(15, 23, 42, 0.18)',
          zIndex: 201,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{displayLabel}</h2>
              {priorityColor && def && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                  background: priorityColor.bg, color: priorityColor.text,
                  border: `1px solid ${priorityColor.border}`,
                }}>
                  {def.priority}
                </span>
              )}
            </div>
            {def?.purpose && (
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
                {def.purpose}
              </p>
            )}
          </div>
          <button
            onClick={close}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', fontSize: 22, lineHeight: 1,
              color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0,
            }}
          >
            &times;
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {ref?.summary && (
            <Section title="In plain language">
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>{ref.summary}</p>
            </Section>
          )}

          {ref && ref.responsibilities.length > 0 && (
            <Section title="What this role does">
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
                {ref.responsibilities.map((r, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{r}</li>
                ))}
              </ul>
            </Section>
          )}

          {ref && ref.typicalDecisions.length > 0 && (
            <Section title="Typical decision authority">
              <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                What this role typically owns or contributes to. Your org may assign these
                differently on the <button onClick={() => { close(); navigate('/decision-rights'); }} style={linkBtnStyle}>Decision Rights</button> page.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ref.typicalDecisions.map((d, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    fontSize: 12,
                  }}>
                    <span
                      title={`${RACI_LABEL[d.raci]} — ${RACI_DESCRIPTION[d.raci]}`}
                      style={{
                        flexShrink: 0, width: 22, height: 22, borderRadius: 4,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700,
                        background: RACI_COLOR[d.raci].bg, color: RACI_COLOR[d.raci].text,
                      }}
                    >
                      {d.raci}
                    </span>
                    <span style={{ flex: 1, lineHeight: 1.5 }}>{d.decision}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 10, color: 'var(--color-text-muted)' }}>
                R = Responsible · A = Accountable · C = Consulted · I = Informed
              </div>
            </Section>
          )}

          {groups.length > 0 && (
            <Section title="Groups that need this role">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {groups.map((g) => (
                  <button
                    key={g.groupType}
                    onClick={() => { close(); navigate('/governance-groups'); }}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderLeft: `3px solid ${g.color}`,
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{g.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {g.description}
                    </div>
                  </button>
                ))}
              </div>
            </Section>
          )}

          {ref && ref.requiredSkills.length > 0 && (
            <Section title="Skills typically needed">
              <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                Reference list - your org's actual hiring profile may differ.
                Manage your catalog on the <button onClick={() => { close(); navigate('/skills'); }} style={linkBtnStyle}>Skills</button> page.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ref.requiredSkills.map((name) => {
                  const match = orgSkills.find((s) => s.name.toLowerCase() === name.toLowerCase());
                  const inCatalog = !!match;
                  return (
                    <span
                      key={name}
                      title={match?.description || (inCatalog ? '' : 'This skill is not in your catalog yet — seed standard skills to add it.')}
                      style={{
                        fontSize: 11, padding: '3px 8px', borderRadius: 12,
                        background: inCatalog ? '#eef2ff' : 'var(--color-bg)',
                        color: inCatalog ? '#3730a3' : 'var(--color-text-muted)',
                        border: inCatalog ? 'none' : '1px dashed var(--color-border)',
                        fontStyle: inCatalog ? 'normal' : 'italic',
                      }}
                    >
                      {name}
                    </span>
                  );
                })}
              </div>
            </Section>
          )}

          <Section title={assignments && assignments.length > 0 ? `Currently held by (${assignments.length})` : 'Currently held by'}>
            {loadingAssignments ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>
            ) : !assignments || assignments.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                No one currently holds this role in your organization.{' '}
                <button onClick={() => { close(); navigate('/dama-roles'); }} style={linkBtnStyle}>
                  Assign someone →
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {assignments.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => { close(); navigate(`/people/${a.personId}`); }}
                    style={{
                      textAlign: 'left',
                      padding: '6px 10px',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {a.personName}
                  </button>
                ))}
              </div>
            )}
          </Section>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <h3 style={{
        margin: '0 0 8px', fontSize: 11, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.05em',
        color: 'var(--color-text-secondary)',
      }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

const linkBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0,
  color: 'var(--color-primary)', cursor: 'pointer',
  fontSize: 'inherit', fontFamily: 'inherit', textDecoration: 'underline',
};
