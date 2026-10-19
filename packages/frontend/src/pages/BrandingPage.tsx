import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { useBrandingStore, DEFAULT_BRANDING, type BrandingConfig } from '@/stores/brandingStore';
import { errorToast, successToast } from '@/lib/errorToast';
import ConfirmDialog from '@/components/ConfirmDialog';
import SaveIndicator, { type SaveState } from '@/components/SaveIndicator';

// White-on-color contrast (WCAG) for the brand colors that carry white text
// (the accent on primary buttons, the sidebar behind white nav labels). The
// readout tells an admin, as they type a hex, whether white text will still be
// legible on it — an un-fakeable accessibility aid, not a guess. Ratio =
// (L_white + 0.05) / (L_color + 0.05), with L_white = 1.
function relLuminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function whiteContrast(hex: string): { text: string; ok: boolean } | null {
  const l = relLuminance(hex);
  if (l === null) return null;
  const r = Math.round((1.05 / (l + 0.05)) * 10) / 10;
  return r >= 4.5
    ? { text: `White text readable (${r.toFixed(1)}:1)`, ok: true }
    : { text: `White text too faint (${r.toFixed(1)}:1, needs 4.5)`, ok: false };
}

// ──────────────────────────────────────────────────────────────────────────
// BrandingPage — admin-facing theming controls. Customers set company
// name, logo (URL or uploaded file → data URL), and five brand colors.
//
// The preview is the page itself: pending edits apply via
// `brandingStore.preview(...)` which mutates the live CSS variables, so
// the sidebar / buttons / chrome update in real time. Cancel reverts by
// re-applying the last-saved branding; Save commits to the server.
//
// Logo uploads are read client-side with FileReader.readAsDataURL and
// posted inline. Backend caps request body at 2MB (see index.ts) which
// comfortably fits a reasonable PNG.
// ──────────────────────────────────────────────────────────────────────────

const MAX_LOGO_BYTES = 1_500_000;   // stay comfortably under the 2MB body cap

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 20,
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4,
  color: 'var(--color-text-secondary)',
};

const textInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px', fontSize: 13,
  border: '1px solid var(--color-border)', borderRadius: 6,
  background: 'var(--color-surface)',
};

export default function BrandingPage() {
  const navigate = useNavigate();
  const { branding, save, reset, preview } = useBrandingStore();
  // Register the breadcrumb leaf so the global trail reads
  // "Dashboard › Settings › Branding" above the header.
  useBreadcrumbLeaf('Branding');

  // Capture the last-saved values so Cancel can restore them.
  const committedRef = useRef<BrandingConfig>(branding);
  useEffect(() => {
    // Only update the baseline when Save or Reset re-seats the store.
    // `preview` doesn't change the saved baseline.
    committedRef.current = branding;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Local draft — mirrors the store for UI binding; changes fire preview
  // so the whole app re-themes as the user types.
  const [draft, setDraft] = useState<BrandingConfig>(branding);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [confirmReset, setConfirmReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep local draft in sync if the store changes out from under us
  // (e.g. another tab saves branding).
  useEffect(() => {
    if (saveState === 'idle') setDraft(branding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branding.updatedAt]);

  function patch(partial: Partial<BrandingConfig>) {
    const next = { ...draft, ...partial };
    setDraft(next);
    preview(partial);
    setSaveState('idle');
  }

  function cancel() {
    setDraft(committedRef.current);
    preview(committedRef.current);
  }

  async function handleSave() {
    setSaveState('saving');
    try {
      // Only send the editable fields; don't leak `updatedAt`.
      const payload: Partial<BrandingConfig> = {
        companyName: draft.companyName,
        logoUrl: draft.logoUrl,
        primaryColor: draft.primaryColor,
        primaryHoverColor: draft.primaryHoverColor,
        primaryLightColor: draft.primaryLightColor,
        sidebarColor: draft.sidebarColor,
        sidebarHoverColor: draft.sidebarHoverColor,
      };
      await save(payload);
      committedRef.current = useBrandingStore.getState().branding;
      setDraft(committedRef.current);
      setSaveState('saved');
      successToast('Branding saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (err) {
      setSaveState('error');
      errorToast(err, 'Could not save branding');
    }
  }

  async function handleReset() {
    setConfirmReset(false);
    setSaveState('saving');
    try {
      await reset();
      committedRef.current = useBrandingStore.getState().branding;
      setDraft(committedRef.current);
      setSaveState('saved');
      successToast('Branding reset to defaults');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (err) {
      setSaveState('error');
      errorToast(err, 'Could not reset branding');
    }
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      errorToast(null, 'Logo must be an image file (PNG, JPG, SVG, etc.)');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      errorToast(null, `Logo is too large (${Math.round(file.size / 1024)}KB). Maximum is ${Math.round(MAX_LOGO_BYTES / 1024)}KB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      patch({ logoUrl: dataUrl });
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const isDirty = (Object.keys(draft) as Array<keyof BrandingConfig>).some(
    (k) => draft[k] !== committedRef.current[k],
  );

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Branding"
        subtitle="Customize the company name, logo, and color palette. Changes apply live across the app and persist for all users."
        meta={isDirty ? <StatusBadge variant="warning">Unsaved changes</StatusBadge> : undefined}
        actions={
          <>
            <SaveIndicator state={saveState} />
            <button
              onClick={() => setConfirmReset(true)}
              style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer' }}
            >
              Reset to defaults
            </button>
            <button
              onClick={cancel}
              disabled={!isDirty || saveState === 'saving'}
              style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 6, cursor: isDirty ? 'pointer' : 'not-allowed', opacity: isDirty ? 1 : 0.5 }}
            >
              Discard changes
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty || saveState === 'saving'}
              style={{ padding: '8px 18px', fontSize: 13, fontWeight: 500, background: isDirty ? 'var(--color-primary)' : '#e5e7eb', color: isDirty ? '#fff' : '#9ca3af', border: 'none', borderRadius: 6, cursor: isDirty ? 'pointer' : 'not-allowed' }}
            >
              Save changes
            </button>
          </>
        }
      />

      {/* Identity */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Identity</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, alignItems: 'flex-start' }}>
          {/* Logo preview */}
          <div>
            <label style={labelStyle}>Logo</label>
            <div style={{
              width: 180, height: 180,
              border: '1px dashed var(--color-border)', borderRadius: 8,
              background: 'var(--color-bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {draft.logoUrl ? (
                <img
                  src={draft.logoUrl}
                  alt="Logo preview"
                  style={{ maxWidth: '85%', maxHeight: '85%', objectFit: 'contain' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.25'; }}
                />
              ) : (
                <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No logo</span>
              )}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              <input ref={fileInputRef} type="file" aria-label="Logo" accept="image/*" onChange={onFileSelected} style={{ display: 'none' }} />
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ padding: '6px 12px', fontSize: 12, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer' }}
              >
                Upload image
              </button>
              <button
                onClick={() => patch({ logoUrl: DEFAULT_BRANDING.logoUrl })}
                style={{ padding: '6px 12px', fontSize: 12, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', color: 'var(--color-text-muted)' }}
              >
                Use default
              </button>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Company name</label>
            <input
              type="text"
              aria-label="Company name"
              value={draft.companyName}
              maxLength={80}
              onChange={(e) => patch({ companyName: e.target.value })}
              style={textInputStyle}
              placeholder="Procela"
            />
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              Shown in the sidebar next to the logo, and in the browser tab title.
            </p>

            <label style={{ ...labelStyle, marginTop: 18 }}>Logo URL</label>
            <input
              type="text"
              aria-label="Logo URL"
              value={draft.logoUrl.startsWith('data:') ? '' : draft.logoUrl}
              onChange={(e) => patch({ logoUrl: e.target.value })}
              style={textInputStyle}
              placeholder="https://example.com/logo.png  —  or upload above"
            />
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              Paste a URL, or use Upload image to inline a local file. Uploaded images are stored with your config.
            </p>
          </div>
        </div>
      </div>

      {/* Colors */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Colors</h2>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 14 }}>
          Two choices drive everything — the accent and the sidebar. Their hover and
          light shades are derived for you; adjust them under Fine-tune. Edits preview
          live across the whole app as you type.
        </p>

        {/* The two primary choices, each with a white-text contrast check since
            both carry white text (accent on buttons, sidebar behind nav labels). */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <ColorField label="Primary (accent)" hint="Primary buttons, active links, focus rings." showContrast
            value={draft.primaryColor} onChange={(v) => patch({ primaryColor: v })} />
          <ColorField label="Sidebar" hint="Background of the left navigation rail." showContrast
            value={draft.sidebarColor} onChange={(v) => patch({ sidebarColor: v })} />
        </div>

        {/* The three derived shades, hidden by default so the common case stays
            to two decisions. */}
        <details style={{ marginTop: 18, borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--color-primary)', fontSize: 13 }}>Fine-tune shades (3)</summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginTop: 12 }}>
            <ColorField label="Primary — hover" hint="Hover state for primary buttons."
              value={draft.primaryHoverColor} onChange={(v) => patch({ primaryHoverColor: v })} />
            <ColorField label="Primary — light" hint="Muted primary: selected chips, active context, background tints."
              value={draft.primaryLightColor} onChange={(v) => patch({ primaryLightColor: v })} />
            <ColorField label="Sidebar — hover" hint="Nav item hover / active state."
              value={draft.sidebarHoverColor} onChange={(v) => patch({ sidebarHoverColor: v })} />
          </div>
        </details>
      </div>

      {/* Swatch preview */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Live preview</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={{ padding: '8px 16px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
            Primary button
          </button>
          <button style={{ padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
            Secondary
          </button>
          <span style={{ display: 'inline-block', padding: '4px 10px', background: 'var(--color-primary-light)', color: 'var(--color-primary)', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
            Status chip
          </span>
          <a href="#" onClick={(e) => e.preventDefault()} style={{ color: 'var(--color-primary)', fontSize: 13, fontWeight: 500 }}>
            Inline link
          </a>
        </div>
        <div style={{ marginTop: 20, display: 'flex', gap: 0, alignItems: 'stretch', border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ background: 'var(--color-sidebar)', color: '#fff', padding: '12px 16px', width: 160 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Sidebar</div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>Nav preview</div>
            <div style={{ marginTop: 8, padding: '6px 8px', background: 'var(--color-sidebar-hover)', borderRadius: 4, fontSize: 12 }}>
              Active item
            </div>
          </div>
          <div style={{ flex: 1, padding: '14px 16px', background: 'var(--color-bg)' }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Content area (neutral surface/bg — not themed)</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button
          onClick={() => navigate('/settings')}
          style={{ padding: '8px 14px', fontSize: 12, background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}
        >
          {'\u2190'} Back to Settings
        </button>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset branding to defaults?"
        message="This will restore the built-in Procela company name, logo, and color palette for everyone. This cannot be undone."
        confirmLabel="Reset"
        variant="primary"
        onConfirm={handleReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

// ── Color field ──
// Uses the native color input plus a hex text field so users can paste
// codes from brand guidelines directly.

interface ColorFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (hex: string) => void;
  /** Show a WCAG white-text contrast readout under the field (for colors
   *  that carry white text — the accent and the sidebar). */
  showContrast?: boolean;
}

function ColorField({ label, hint, value, onChange, showContrast }: ColorFieldProps) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);

  const contrast = showContrast ? whiteContrast(value) : null;

  function commitText() {
    const v = text.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) onChange(v.toLowerCase());
    else setText(value);  // revert
  }

  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="color"
          aria-label={label}
          value={/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 36, height: 36, padding: 0, border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
        />
        <input
          type="text"
          aria-label={label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => { if (e.key === 'Enter') commitText(); }}
          style={{ ...textInputStyle, fontFamily: 'var(--font-mono, ui-monospace, monospace)', textTransform: 'lowercase' }}
          placeholder="#1a7a6d"
        />
      </div>
      {hint && <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{hint}</p>}
      {contrast && (
        <p style={{ fontSize: 11, fontWeight: 600, marginTop: 4, color: contrast.ok ? 'var(--color-success)' : 'var(--color-error)' }}>
          {contrast.text}
        </p>
      )}
    </div>
  );
}
