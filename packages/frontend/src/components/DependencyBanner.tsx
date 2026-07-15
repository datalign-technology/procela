import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';

interface DependencyCheck {
  label: string;
  met: boolean;
  link: string;
}

interface DependencyBannerProps {
  phase: string;
  checks: DependencyCheck[];
}

export default function DependencyBanner({ phase, checks }: DependencyBannerProps) {
  const unmet = checks.filter(c => !c.met);
  if (unmet.length === 0) return null;

  return (
    <div style={{
      background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 'var(--radius-md)',
      padding: '12px 16px', marginBottom: 16, fontSize: 13,
    }}>
      <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 6 }}>
        Prerequisites needed
      </div>
      <div style={{ color: '#78350f', lineHeight: 1.6 }}>
        {unmet.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <AlertTriangle size={12} strokeWidth={2.2} color="#d97706" aria-hidden="true" />
            <span>{c.label}</span>
            <Link to={c.link} style={{ color: '#92400e', fontWeight: 500, textDecoration: 'underline', marginLeft: 4 }}>Set up</Link>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#92400e', marginTop: 8, fontStyle: 'italic' }}>
        Sequence matters: {phase}
      </div>
    </div>
  );
}

export function useDependencyChecks() {
  const { activeOrgId } = useOrgContext();
  const [checks, setChecks] = useState<{
    hasScope: boolean;
    hasPrinciples: boolean;
    hasDomains: boolean;
    hasGroups: boolean;
    hasCouncil: boolean;
    hasCommittee: boolean;
    hasRoles: boolean;
    hasStewards: boolean;
    hasPolicies: boolean;
  }>({
    hasScope: false, hasPrinciples: false, hasDomains: false, hasGroups: false,
    hasCouncil: false, hasCommittee: false, hasRoles: false, hasStewards: false, hasPolicies: false,
  });

  useEffect(() => {
    if (!activeOrgId) return;
    (async () => {
      try {
        interface ProgResp { data: { scope?: { inScope?: string }; principles?: { principles?: unknown[] } } | null }
        interface Group { type?: string }
        interface Role { roleType?: string }
        const [progRes, domRes, groupRes, roleRes, polRes] = await Promise.all([
          apiClient.get<ProgResp>(`/governance-program?orgId=${activeOrgId}`),
          apiClient.get<{ data: unknown[] }>(`/data-domains?orgId=${activeOrgId}`),
          apiClient.get<{ data: Group[] }>(`/governance-groups?orgId=${activeOrgId}`),
          apiClient.get<{ data: Role[] }>(`/dama-roles?orgId=${activeOrgId}`),
          apiClient.get<{ data: unknown[] }>(`/governance-policies?orgId=${activeOrgId}`).catch(() => ({ data: [] as unknown[] })),
        ]);
        const prog = progRes.data;
        const domains = domRes.data || [];
        const groups = groupRes.data || [];
        const roles = roleRes.data || [];
        const policies = polRes.data || [];
        setChecks({
          hasScope: !!(prog?.scope?.inScope?.trim().length),
          hasPrinciples: (prog?.principles?.principles?.length ?? 0) > 0,
          hasDomains: domains.length > 0,
          hasGroups: groups.length > 0,
          hasCouncil: groups.some((g) => g.type === 'COUNCIL'),
          hasCommittee: groups.some((g) => g.type === 'COMMITTEE'),
          hasRoles: roles.length > 0,
          hasStewards: roles.some((r) => r.roleType === 'BUSINESS_DATA_STEWARD' || r.roleType === 'TECHNICAL_DATA_STEWARD'),
          hasPolicies: policies.length > 0,
        });
      } catch { /* */ }
    })();
  }, [activeOrgId]);

  return checks;
}
