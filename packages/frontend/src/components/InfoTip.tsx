import { useState, useRef, useEffect, useLayoutEffect } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// InfoTip — dictionary-driven "?" tooltip for key Procela terms.
//
// Usage:
//   <InfoTip term="Data Asset" />
//   <InfoTip term="Governance Tier" inline />
//
// The GLOSSARY is also exported so other components can read definitions
// without rendering a tooltip (e.g. for search, onboarding wizards).
// ──────────────────────────────────────────────────────────────────────────

export const GLOSSARY: Record<string, string> = {
  'Value Stream':
    'An end-to-end flow of activities that delivers value to a customer or stakeholder. Value streams are the highest level in the process hierarchy.',
  'Process':
    'A defined set of activities that achieves a specific business outcome. Processes sit within value streams.',
  'Activity':
    'A specific unit of work within a process, with defined inputs, outputs, and a responsible role.',
  'Data Asset':
    'A business-meaningful piece of data your organization relies on — described in plain language, not technical schema.',
  'Data Domain':
    'A logical grouping of related data assets, typically organized by business function (e.g., Customer Data, Financial Data).',
  'Governance Tier':
    'A maturity level for a data asset: Uncertified (catalogued but not yet governed), Managed (owner and steward assigned), or Certified (fully governed and audit-ready).',
  'Health Score':
    'A 0–100 rating of a data asset’s quality and reliability. Higher scores mean more trustworthy data.',
  'RACI':
    'Responsible, Accountable, Consulted, Informed — a matrix that clarifies who does what for each process.',
  'Data Steward':
    'The person responsible for the day-to-day management and quality of a data asset or domain.',
  'Data Owner':
    'The business leader accountable for a data domain or asset. They set policy; stewards execute it.',
  'Mapping':
    'A link between a process step and a data asset, showing which data supports which business activity.',
  'Gap':
    'A process step with no data assets linked, or a data asset with no governance — a risk that needs attention.',
  'DAMA':
    'The Data Management Association framework — an industry standard for organizing data governance practices.',
  'Governance Group':
    'An organizational body (Council, Office, Committee, Working Group) that oversees data governance decisions.',
  'Domain Lens':
    'Filters the page between operational work (running the business) and governance work (looking after the data and the rules). Pick "All" to see both. Each page remembers its own choice.',
};

interface InfoTipProps {
  term: string;
  inline?: boolean;
}

export default function InfoTip({ term, inline }: InfoTipProps) {
  const explanation = GLOSSARY[term];
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  // Fixed-position coords computed from the trigger so the tooltip is
  // never clipped — the old absolute "bottom: 100%" rendered upward and
  // got cut off the top of the screen when the trigger sat in a page
  // header (e.g. Process-Data Mappings).
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const showTip = () => {
    timerRef.current = setTimeout(() => setVisible(true), 200);
  };

  const hideTip = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  };

  // Place the tooltip below the trigger by default (page headers sit at
  // the top, so there's room below); flip above only if it would spill
  // off the bottom. Clamp horizontally to an 8px viewport margin.
  useLayoutEffect(() => {
    if (!visible) return;
    const trigger = wrapperRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const t = trigger.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const margin = 8;
    const gap = 8;
    let left = t.left + t.width / 2 - w / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    let top = t.bottom + gap;
    if (top + h > window.innerHeight - margin && t.top - gap - h > margin) {
      top = t.top - gap - h; // flip above when there's no room below
    }
    setPos({ top, left });
  }, [visible]);

  if (!explanation) return null;

  return (
    <span
      ref={wrapperRef}
      onMouseEnter={showTip}
      onMouseLeave={hideTip}
      onFocus={showTip}
      onBlur={hideTip}
      style={{
        position: 'relative',
        display: inline ? 'inline-flex' : 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {/* Trigger circle — also handles click/touch (for users without
          hover) and Enter/Space/Escape so it isn't keyboard-trap-only. */}
      <span
        role="button"
        tabIndex={0}
        aria-label={`Info: ${term}`}
        aria-expanded={visible}
        onClick={() => setVisible((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setVisible((v) => !v); }
          if (e.key === 'Escape') { e.preventDefault(); setVisible(false); }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          borderRadius: '50%',
          border: '1px solid var(--color-text-muted)',
          fontSize: 9,
          fontWeight: 600,
          lineHeight: 1,
          color: 'var(--color-text-muted)',
          cursor: 'help',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        ?
      </span>

      {/* Tooltip — fixed + viewport-clamped so it can't be clipped by
          the header or screen edges. */}
      {visible && (
        <span
          ref={tipRef}
          role="tooltip"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: 280,
            padding: '8px 12px',
            background: '#1e293b',
            color: '#fff',
            fontSize: 11,
            lineHeight: 1.5,
            borderRadius: 6,
            zIndex: 1000,
            pointerEvents: 'none',
            whiteSpace: 'normal',
            textAlign: 'left',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          <span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>{term}</span>
          {explanation}
        </span>
      )}
    </span>
  );
}
