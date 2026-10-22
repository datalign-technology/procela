// Attested-certification badge (docs/CERTIFICATION_DESIGN.md). This is the
// `certificationStatus === 'CERTIFIED'` attestation — a reviewed sign-off with
// a recertification date — which is distinct from the GOLD governance *tier*.
// Rendered next to the tier wherever data assets appear in a list.

export type CertStatus = 'NONE' | 'PENDING_REVIEW' | 'CERTIFIED';

/** Date-only (no time) formatting for recertification dates. */
export function certDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
}

/** The pill palette + label for a certification status, or null for NONE
 *  (which shows nothing). A CERTIFIED asset past its recert date reads
 *  "recert due" in amber rather than silently keeping the green badge. */
export function certStatusPill(
  status: CertStatus | string | null | undefined,
  certifiedUntil?: string | null,
): { label: string; bg: string; color: string; title: string } | null {
  if (status === 'PENDING_REVIEW') {
    return { label: 'Certification pending', bg: '#fef3c7', color: '#92400e', title: 'A certification request is awaiting reviewer sign-off.' };
  }
  if (status === 'CERTIFIED') {
    const overdue = certifiedUntil ? new Date(certifiedUntil).getTime() < Date.now() : false;
    return overdue
      ? { label: 'Certified · recert due', bg: '#fef3c7', color: '#92400e', title: certifiedUntil ? `Certified, but recertification was due ${certDate(certifiedUntil)}.` : 'Certified; recertification is due.' }
      : { label: 'Certified', bg: '#dcfce7', color: '#166534', title: certifiedUntil ? `Reviewed and certified. Recertification due ${certDate(certifiedUntil)}.` : 'Reviewed and certified.' };
  }
  return null;
}

/** A small "Certified" / "recert due" / "pending" pill. Renders nothing when
 *  the asset is not in the certification workflow (status NONE / unset), so it
 *  can be dropped next to a TierBadge unconditionally. `compact` drops the
 *  label on the overdue/pending variants to a short form for dense rows. */
export default function CertifiedBadge({
  status, certifiedUntil, size = 'sm', compact = false,
}: {
  status?: CertStatus | string | null;
  certifiedUntil?: string | null;
  size?: 'sm' | 'md';
  compact?: boolean;
}) {
  const pill = certStatusPill(status, certifiedUntil);
  if (!pill) return null;
  const label = compact
    ? (pill.label.startsWith('Certified · ') ? 'Recert due' : pill.label === 'Certification pending' ? 'Pending' : pill.label)
    : pill.label;
  const dims = size === 'md'
    ? { height: 24, padding: '0 10px', fontSize: 12 }
    : { height: 20, padding: '0 8px', fontSize: 11 };
  return (
    <span
      title={pill.title}
      style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, background: pill.bg, color: pill.color, fontWeight: 600, whiteSpace: 'nowrap', ...dims }}
    >
      {label}
    </span>
  );
}
