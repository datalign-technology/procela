import React from 'react';

// ──────────────────────────────────────────────────────────────────────────
// a11y helpers for elements that are visually clickable but aren't native
// <button>/<a> (filter rows, tree nodes, grid cells, …). Native buttons
// already handle Enter/Space + focus; these bring the same behavior to the
// <div>/<span>/<td> equivalents.
// ──────────────────────────────────────────────────────────────────────────

// Keyboard activation mirroring a native button: Enter and Space fire the
// handler (Space's default page-scroll is suppressed).
export function activateOnKey(handler: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}

// Same as activateOnKey but also stops propagation — for a clickable element
// nested inside another clickable element (e.g. a tree node's expand toggle
// inside a selectable row) so activating the child doesn't also fire the
// parent.
export function activateOnKeyStop(handler: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      handler();
    }
  };
}

interface ClickableOpts {
  label?: string;
  /** Toggle state for a pressable filter/tab — sets aria-pressed. */
  pressed?: boolean;
  disabled?: boolean;
}

// Prop bundle that makes a non-button element behave like a button for both
// pointer and keyboard users. Spread onto the element and drop its existing
// onClick (this provides it):
//   <div {...clickable(() => setFilter(x), { pressed: active })} style={…} />
export function clickable(handler: () => void, opts: ClickableOpts = {}) {
  const props: React.HTMLAttributes<HTMLElement> & { tabIndex: number } = {
    role: 'button',
    tabIndex: opts.disabled ? -1 : 0,
    onClick: opts.disabled ? undefined : handler,
    onKeyDown: opts.disabled ? undefined : activateOnKey(handler),
  };
  if (opts.label) props['aria-label'] = opts.label;
  if (opts.pressed !== undefined) props['aria-pressed'] = opts.pressed;
  if (opts.disabled) props['aria-disabled'] = true;
  return props;
}
