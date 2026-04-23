import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ color: '#d97706' }}>●</span>
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
        const [progRes, domRes, groupRes, roleRes, polRes] = await Promise.all([
          apiClient.get<any>(`/governance-program?orgId=${activeOrgId}`),
          apiClient.get<any>(`/data-domains?orgId=${activeOrgId}`),
          apiClient.get<any>(`/governance-groups?orgId=${activeOrgId}`),
          apiClient.get<any>(`/dama-roles?orgId=${activeOrgId}`),
          apiClient.get<any>(`/governance-policies?orgId=${activeOrgId}`).catch(() => ({ data: [] })),
        ]);
        const prog = progRes.data;
        const domains = domRes.data || [];
        const groups = groupRes.data || [];
        const roles = roleRes.data || [];
        const policies = polRes.data || [];
        setChecks({
          hasScope: prog?.scope?.inScope?.trim().length > 0,
          hasPrinciples: prog?.principles?.principles?.length > 0,
          hasDomains: domains.length > 0,
          hasGroups: groups.length > 0,
          hasCouncil: groups.some((g: any) => g.type === 'COUNCIL'),
          hasCommittee: groups.some((g: any) => g.type === 'COMMITTEE'),
          hasRoles: roles.length > 0,
          hasStewards: roles.some((r: any) => r.roleType === 'BUSINESS_DATA_STEWARD' || r.roleType === 'TECHNICAL_DATA_STEWARD'),
          hasPolicies: policies.length > 0,
        });
      } catch { /* */ }
    })();
  }, [activeOrgId]);

  return checks;
}
