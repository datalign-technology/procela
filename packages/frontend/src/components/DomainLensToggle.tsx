import { useDomainLensStore, useDomainLens, DomainLens } from '../stores/domainLensStore';
import InfoTip from './InfoTip';
import SegmentedControl from './SegmentedControl';

// Segmented "All · Operational · Governance" control. Each page passes a
// stable `pageKey` so its lens is independent — setting Governance on
// Data Assets no longer affects the Process Catalog and vice versa.
// `defaultLens` is the value used until the user picks something on
// that page.

const OPTIONS: Array<{ value: DomainLens; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'OPERATIONAL', label: 'Operational' },
  { value: 'GOVERNANCE', label: 'Governance' },
];

export default function DomainLensToggle({
  pageKey,
  defaultLens = 'ALL',
}: {
  pageKey: string;
  defaultLens?: DomainLens;
}) {
  const lens = useDomainLens(pageKey, defaultLens);
  const setLens = useDomainLensStore((s) => s.setLens);

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <SegmentedControl
        ariaLabel="Governance / operational lens"
        options={OPTIONS}
        value={lens}
        onChange={(v) => setLens(pageKey, v)}
      />
      <InfoTip term="Domain Lens" inline />
    </div>
  );
}
