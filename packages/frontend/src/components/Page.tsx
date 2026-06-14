import React from 'react';

export type PageWidth = 'default' | 'narrow' | 'wizard';

interface PageProps {
  /**
   * Width preset for the outer container.
   *
   *  - `default` — no width constraint; the page anchors to the Layout's
   *    content padding. Use for tables, dashboards, every operational page.
   *  - `narrow` — ~820 px max, horizontally centred. Use only for long-form
   *    reading text (HelpPage).
   *  - `wizard` — ~820 px max, left-anchored (no auto margin). Use for
   *    stepped flows that benefit from a constrained reading width but
   *    should still match the rest of the app's left edge (AssignOwners,
   *    ValueStreamWizard, SetupHub).
   *
   * Don't hand-roll a literal maxWidth on a page-level container — that's
   * the bug that hit Setup Hub (page rendered narrower than its peers
   * because someone added `maxWidth: 860` without `margin: 0 auto`). If
   * none of these presets fit your case, extend the menu in one place
   * instead of smuggling in a one-off value.
   */
  width?: PageWidth;
  /**
   * Optional bottom padding for the outer container. Useful when a long
   * wizard or doc-style page needs extra breathing room before the next
   * screen. Caller passes a CSS string (e.g. '0 0 64px').
   */
  padding?: string;
  /** Standard HTML attributes — id, className, data-* — pass through. */
  id?: string;
  className?: string;
  children: React.ReactNode;
}

const WIDTH_STYLES: Record<PageWidth, React.CSSProperties> = {
  default: {},
  narrow: { maxWidth: 820, margin: '0 auto' },
  wizard: { maxWidth: 820 },
};

/**
 * Page — the standard outer container for any routed view in the app.
 * Wraps children in a `<div>` whose width comes from a preset menu rather
 * than ad-hoc inline styles, so the "wrong width" class of bug (e.g. a
 * page rendering noticeably narrower than its siblings) can't recur.
 *
 * Pages should:
 *   `<Page>`                — operational pages (tables, dashboards)
 *   `<Page width="narrow">` — long-form reading content
 *   `<Page width="wizard">` — stepped flows / Setup Hub style
 *
 * PageHeader is still imported and rendered separately as a child —
 * coupling them here would force every caller through the same header
 * model, which doesn't fit pages with custom toolbars or filter rows.
 */
export default function Page({
  width = 'default',
  padding,
  id,
  className,
  children,
}: PageProps) {
  return (
    <div
      id={id}
      className={className}
      style={{
        ...WIDTH_STYLES[width],
        ...(padding ? { padding } : {}),
      }}
    >
      {children}
    </div>
  );
}
