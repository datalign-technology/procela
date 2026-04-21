import { useState, useRef, useEffect } from 'react';

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
    'A maturity level for a data asset: Bronze (raw/minimal governance), Silver (managed), or Gold (fully governed and certified).',
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
      {/* Trigger circle */}
      <span
        role="button"
        tabIndex={0}
        aria-label={`Info: ${term}`}
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

      {/* Tooltip */}
      {visible && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 280,
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
          {/* Arrow pointing down */}
          <span
            style={{
              position: 'absolute',
              bottom: -4,
              left: '50%',
              transform: 'translateX(-50%) rotate(45deg)',
              width: 8,
              height: 8,
              background: '#1e293b',
            }}
          />
        </span>
      )}
    </span>
  );
}
