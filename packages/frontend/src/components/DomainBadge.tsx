import type { DomainValue } from '../stores/domainLensStore';

// Small chip used wherever governance and operational items co-mingle
// (Enterprise View, Analysis, mixed lists) so the kind is unmistakable
// at a glance. Operational is the unmarked default — only governance
// renders, to keep operational lists visually quiet.

export default function DomainBadge({ domain, title }: { domain: DomainValue | null | undefined; title?: string }) {
  if (domain !== 'GOVERNANCE') return null;
  return (
    <span
      title={title || 'Part of the data governance program'}
      style={{
        display: 'inline-block', padding: '1px 6px', borderRadius: 3,
        fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
        background: '#ede9fe', color: '#5b21b6', textTransform: 'uppercase',
      }}
    >
      Gov
    </span>
  );
}
