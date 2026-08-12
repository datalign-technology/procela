import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { activateOnKey } from '../lib/a11y';
import SectionLabel from './SectionLabel';

interface CollapsibleSectionProps {
  title: string;
  /** Item count shown in the header (e.g. "Discussion (2)"). Omit to show
   *  no count. */
  count?: number;
  open: boolean;
  onToggle: () => void;
  /** Optional right-aligned control (e.g. an "+ Add" button), only shown
   *  while the section is open. */
  action?: React.ReactNode;
  children: React.ReactNode;
}

// A compact disclosure row used for the per-node Attachments / Discussion /
// Activity panels. Collapsed by default to keep the tree from ballooning;
// children stay mounted (hidden when closed) so the header count stays live
// without the user having to open the section first.
export default function CollapsibleSection({ title, count, open, onToggle, action, children }: CollapsibleSectionProps) {
  return (
    <div style={{ marginTop: 'var(--space-section)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={onToggle}
          onKeyDown={activateOnKey(onToggle)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1, minWidth: 0 }}
        >
          <span style={{ color: 'var(--color-text-muted)', display: 'inline-flex', flexShrink: 0 }} aria-hidden="true">
            {open ? <ChevronDown size={12} strokeWidth={2.2} /> : <ChevronRight size={12} strokeWidth={2.2} />}
          </span>
          <SectionLabel marginBottom={0}>
            {title}{typeof count === 'number' ? ` (${count})` : ''}
          </SectionLabel>
        </div>
        {open && action}
      </div>
      <div hidden={!open} style={{ marginTop: 6 }}>
        {children}
      </div>
    </div>
  );
}
