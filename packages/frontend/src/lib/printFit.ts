// Scale a wide element down to fit the printable landscape page width on
// print, then restore afterwards. A diagram or table wider than the page
// otherwise clips at the edge in a PDF, which can't scroll horizontally.
//
// Landscape US Letter with 0.5in margins = 10in usable = 960 CSS px (A4
// landscape is a little wider, so 960 fits both). `scrollWidth` is the
// element's untransformed layout width in CSS px, which is the same unit the
// print page uses, so `960 / scrollWidth` is the scale that makes it fit.
//
// The caller pairs this with a print stylesheet rule that consumes the var:
//   @media print { [data-print-fit] {
//     transform: scale(var(--print-fit)) !important;
//     transform-origin: top left !important;
//   } }

const PRINT_WIDTH_PX = 960;

/**
 * Install beforeprint/afterprint hooks that scale `getEl()` to fit the
 * printable width. Returns a disposer; call it on unmount.
 */
export function installPrintFit(getEl: () => HTMLElement | null): () => void {
  const apply = () => {
    const el = getEl();
    if (!el) return;
    const contentW = el.scrollWidth;
    const scale = contentW > PRINT_WIDTH_PX ? PRINT_WIDTH_PX / contentW : 1;
    el.style.setProperty('--print-fit', String(scale));
    el.setAttribute('data-print-fit', '1');
  };
  const clear = () => {
    const el = getEl();
    if (!el) return;
    el.style.removeProperty('--print-fit');
    el.removeAttribute('data-print-fit');
  };

  window.addEventListener('beforeprint', apply);
  window.addEventListener('afterprint', clear);

  // Safari has historically fired matchMedia('print') changes rather than the
  // beforeprint/afterprint events — cover both.
  let mq: MediaQueryList | null = null;
  const onMq = (e: MediaQueryListEvent) => (e.matches ? apply() : clear());
  try {
    mq = window.matchMedia('print');
    mq.addEventListener?.('change', onMq);
  } catch { /* matchMedia unavailable — beforeprint covers it */ }

  return () => {
    window.removeEventListener('beforeprint', apply);
    window.removeEventListener('afterprint', clear);
    mq?.removeEventListener?.('change', onMq);
  };
}
