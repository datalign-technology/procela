import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useRoleDrawerStore } from '../stores/roleDrawerStore';
import { useOrgContext } from '../stores/orgContext';
import { useTerm } from '../lib/terminology';
import DetailDrawer from './DetailDrawer';
import {
  getRoleDef,
  getRoleReference,
  groupsExpectingRole,
  getRoleCategory,
  getRoleScope,
  RACI_LABEL,
  RACI_DESCRIPTION,
  RACI_COLOR,
} from '../lib/roleDefinitions';
import type { GovernanceRoleDef, RolePriority } from '../types';
import StatusBadge, { type StatusBadgeVariant } from './StatusBadge';

// Priority levels share their colour story with StatusBadge:
// ESSENTIAL reads as success, RECOMMENDED as info, OPTIONAL as neutral.
// Centralised here so the two call sites that surface priority chips
// stay visually identical without re-importing PRIORITY_COLORS.
const PRIORITY_TO_VARIANT: Record<RolePriority, StatusBadgeVariant> = {
  ESSENTIAL: 'success',
  RECOMMENDED: 'info',
  OPTIONAL: 'neutral',
};

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
  // Recommended people for this role, ranked by skill-name overlap
  // with the role's static `requiredSkills` list. Populated only for
  // DAMA / governance roles (the "dama" category) since the static
  // role definitions only carry skills for those. Entity-attached
  // roles (System Owner etc.) don't have a required-skills list.
  const [recommendedPeople, setRecommendedPeople] = useState<Array<{
    personId: string; personName: string; ratio: number; matched: number; required: number;
  }>>([]);

  useEffect(() => {
    if (!roleType || !activeOrgId) return;
    let cancelled = false;
    setLoadingAssignments(true);

    // Skills are always loaded; the holders source depends on whether
    // the role is enterprise-scoped (DAMA - one assignment per person)
    // or entity-scoped (System Owner etc. - one assignment per host
    // record). For entity roles we read the host entities directly and
    // synthesize per-holder Assignment rows so the rendering below
    // doesn't have to branch.
    const category = getRoleCategory(roleType);

    // /people is loaded for entity roles only - DAMA assignments are
    // already enriched with personName by the server. Saves a roundtrip
    // for the common drawer-on-DAMA-chip case.
    const fetchPeople = category === 'entity'
      ? apiClient.get<{ success: boolean; data: Array<{ id: string; name: string }> }>(`/people?orgId=${activeOrgId}`)
          .then((res) => new Map((res.data || []).map((p) => [p.id, p.name])))
      : Promise.resolve(new Map<string, string>());

    const fetchHolders = (peopleNames: Map<string, string>) => category === 'entity'
      ? fetchEntityRoleHolders(roleType, activeOrgId, peopleNames)
      : apiClient
          .get<{ success: boolean; data: Assignment[] }>(`/dama-roles?orgId=${activeOrgId}`)
          .then((res) => (res.data || []).filter((a) => a.roleType === roleType));

    // Fetch role recommendations in parallel when we have a static
    // role reference with required skills. Failure is silent — the
    // panel just hides if recommendations aren't available.
    const refForRecs = getRoleReference(roleType);
    const fetchRecs = refForRecs && refForRecs.requiredSkills && refForRecs.requiredSkills.length > 0
      ? apiClient
          .get<{ success: boolean; data: Array<{ personId: string; personName: string; ratio: number; matched: number; required: number }> }>(
            `/skills/recommend-for-role?orgId=${encodeURIComponent(activeOrgId)}&skills=${encodeURIComponent(refForRecs.requiredSkills.join(','))}`,
          )
          .then((res) => res.data || [])
          .catch(() => [])
      : Promise.resolve([] as Array<{ personId: string; personName: string; ratio: number; matched: number; required: number }>);

    fetchPeople
      .then((peopleNames) => Promise.all([
        fetchHolders(peopleNames),
        apiClient.get<{ success: boolean; data: SkillRecord[] }>(`/skills?orgId=${activeOrgId}`),
        fetchRecs,
      ]))
      .then(([holders, skillsRes, recs]) => {
        if (cancelled) return;
        setAssignments(holders);
        setOrgSkills(skillsRes.data || []);
        setRecommendedPeople(recs);
      })
      .catch(() => {
        if (cancelled) return;
        setAssignments([]);
        setOrgSkills([]);
        setRecommendedPeople([]);
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
  const category = getRoleCategory(roleType);
  const scope = getRoleScope(roleType);

  // DAMA-only fields live on GovernanceRoleDef but not EntityRoleDef.
  // Narrow with a category check rather than `in`/cast soup.
  const damaDef = category === 'governance' ? (def as GovernanceRoleDef | null) : null;

  // Custodian gets the plain-terminology swap; everything else uses its
  // canonical DAMA label.
  const rawLabel = def?.label ?? roleType;
  const displayLabel = roleType === 'DATA_CUSTODIAN'
    ? rawLabel.replace('Custodian', custodianLabel)
    : rawLabel;

  // Title carries the inline priority + scope badges so they sit beside
  // the role name without crowding the close button. Subtitle is the
  // one-line purpose; the rest of the reference content lives in the
  // scrolling body below.
  const titleNode = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 18 }}>{displayLabel}</span>
      {damaDef && (
        <StatusBadge variant={PRIORITY_TO_VARIANT[damaDef.priority]} outlined>
          {damaDef.priority}
        </StatusBadge>
      )}
      {/* Scope badge for entity-attached roles - makes it clear at a
        * glance that System Owner is per-system, Domain Owner is
        * per-domain, etc. Helps users grok that two people both
        * being a System Owner isn't a RACI violation. */}
      {category === 'entity' && (
        <StatusBadge variant="neutral" outlined>
          {scope === 'system' ? 'Per system' : scope === 'dataAsset' ? 'Per asset' : 'Per domain'}
        </StatusBadge>
      )}
    </div>
  );

  return (
    <DetailDrawer
      open
      onClose={close}
      width={520}
      title={titleNode}
      subtitle={damaDef?.purpose}
      ariaLabel={`${displayLabel} role details`}
    >
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

          {/* Best-matching people. Ranked by skill-name overlap with the
              required-skills list above. Shown only when we have one or
              more matches — an empty list would just be noise. Click a
              name to deep-link into the Person detail page so the
              operator can promote, assign, or just verify the match. */}
          {recommendedPeople.length > 0 && (
            <Section title="Best-matching people">
              <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                Ranked by overlap with the required-skills list above.
                Useful when you're staffing a new role assignment.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recommendedPeople.map((rec) => (
                  <button
                    key={rec.personId}
                    onClick={() => { close(); navigate(`/people/${rec.personId}`); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)', borderRadius: 6,
                      cursor: 'pointer', fontSize: 12, textAlign: 'left', width: '100%',
                      color: 'var(--color-text)',
                    }}
                  >
                    <span style={{ flex: 1, fontWeight: 500 }}>{rec.personName}</span>
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      padding: '2px 8px', borderRadius: 10,
                      background: rec.ratio >= 0.75 ? '#d1fae5' : rec.ratio >= 0.5 ? '#dbeafe' : '#fef3c7',
                      color:      rec.ratio >= 0.75 ? '#065f46' : rec.ratio >= 0.5 ? '#1e3a8a' : '#92400e',
                    }}>
                      {rec.matched} / {rec.required} skills
                    </span>
                  </button>
                ))}
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
    </DetailDrawer>
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

// ──────────────────────────────────────────────────────────────────────────
// Entity-role holder lookup.
//
// For DAMA roles, "Currently held by" is one /dama-roles call. For
// entity-attached roles the holder is a foreign key on the host entity,
// so we read the host list and synthesize per-holder Assignment rows.
// Multiple host records can have the same holder (e.g. one person owns
// three systems); we dedupe and keep the count visible by showing the
// number after the name where it's > 1.
// ──────────────────────────────────────────────────────────────────────────

interface EntityWithOwner { id: string; name?: string; ownerPersonId?: string | null; deputyOwnerId?: string | null; custodianIds?: string[] | null; }
interface EntityWithStewards { id: string; name?: string; ownerPersonId?: string | null; stewardIds?: string[] | null; }
interface DomainEntity { id: string; name?: string; ownerId?: string | null; stewards?: Array<{ id: string }>; }

async function fetchEntityRoleHolders(
  roleType: string,
  orgId: string,
  peopleNames: Map<string, string>,
): Promise<Assignment[]> {
  const q = `?orgId=${orgId}`;
  switch (roleType) {
    case 'SYSTEM_OWNER': {
      const res = await apiClient.get<{ success: boolean; data: EntityWithOwner[] }>(`/systems${q}`);
      return holdersFromSingleFk(roleType, res.data || [], (s) => s.ownerPersonId, peopleNames);
    }
    case 'SYSTEM_DEPUTY_OWNER': {
      const res = await apiClient.get<{ success: boolean; data: EntityWithOwner[] }>(`/systems${q}`);
      return holdersFromSingleFk(roleType, res.data || [], (s) => s.deputyOwnerId, peopleNames);
    }
    case 'SYSTEM_CUSTODIAN': {
      const res = await apiClient.get<{ success: boolean; data: EntityWithOwner[] }>(`/systems${q}`);
      return holdersFromMultiFk(roleType, res.data || [], (s) => s.custodianIds || [], peopleNames);
    }
    case 'DATA_ASSET_OWNER': {
      const res = await apiClient.get<{ success: boolean; data: EntityWithStewards[] }>(`/data-assets${q}`);
      return holdersFromSingleFk(roleType, res.data || [], (a) => a.ownerPersonId, peopleNames);
    }
    case 'DATA_ASSET_STEWARD': {
      const res = await apiClient.get<{ success: boolean; data: EntityWithStewards[] }>(`/data-assets${q}`);
      return holdersFromMultiFk(roleType, res.data || [], (a) => a.stewardIds || [], peopleNames);
    }
    case 'DATA_DOMAIN_OWNER': {
      const res = await apiClient.get<{ success: boolean; data: DomainEntity[] }>(`/data-domains${q}`);
      return holdersFromSingleFk(roleType, res.data || [], (d) => d.ownerId, peopleNames);
    }
    case 'DATA_DOMAIN_STEWARD': {
      const res = await apiClient.get<{ success: boolean; data: DomainEntity[] }>(`/data-domains${q}`);
      return holdersFromMultiFk(roleType, res.data || [], (d) => (d.stewards || []).map((s) => s.id), peopleNames);
    }
    default:
      return [];
  }
}

function holdersFromSingleFk<T extends { id: string }>(
  roleType: string,
  rows: T[],
  pick: (row: T) => string | null | undefined,
  peopleNames: Map<string, string>,
): Assignment[] {
  // Dedupe so a person who holds the role on N entities appears once.
  // We still record the first scopeId we saw them on so the drawer can
  // link to a relevant detail page if needed.
  const seen = new Set<string>();
  const out: Assignment[] = [];
  for (const row of rows) {
    const personId = pick(row);
    if (!personId || seen.has(personId)) continue;
    seen.add(personId);
    out.push({
      id: `${roleType}-${personId}`,
      personId,
      personName: peopleNames.get(personId) || 'Unknown',
      roleType,
      scopeId: row.id,
    });
  }
  return out;
}

function holdersFromMultiFk<T extends { id: string }>(
  roleType: string,
  rows: T[],
  pick: (row: T) => string[],
  peopleNames: Map<string, string>,
): Assignment[] {
  const seen = new Set<string>();
  const out: Assignment[] = [];
  for (const row of rows) {
    for (const personId of pick(row)) {
      if (!personId || seen.has(personId)) continue;
      seen.add(personId);
      out.push({
        id: `${roleType}-${personId}`,
        personId,
        personName: peopleNames.get(personId) || 'Unknown',
        roleType,
        scopeId: row.id,
      });
    }
  }
  return out;
}
