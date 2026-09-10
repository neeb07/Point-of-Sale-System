/**
 * Turning measured receipt heights into the page rules that print them.
 *
 * Kept out of the React component and free of the DOM so it can be run and
 * checked directly. Measuring needs a browser; deciding what to do with the
 * measurements does not, and the deciding is where the bug was.
 */

/**
 * Roll dimensions.
 *
 * Two numbers per roll, and the difference between them matters. `page` is the
 * physical width of the paper — what the driver feeds. `content` is the strip
 * the print head can actually reach, which is narrower on every thermal
 * printer. Laying a receipt out at the full roll width pushes its right-hand
 * edge past the head, and the text comes out clipped rather than wrapped.
 */
export const ROLLS = {
  '58mm': { pageMm: 58, contentMm: 48 },
  '80mm': { pageMm: 80, contentMm: 72 },
};

/** Anything unrecognised is treated as the common case rather than refused. */
export function rollFor(paperSize) {
  return ROLLS[paperSize] || ROLLS['80mm'];
}

/** CSS px are 1/96 inch by definition, so this is exact, not an approximation. */
export function pxToMm(px) {
  return (Number(px) * 25.4) / 96;
}

/**
 * The few millimetres past the last line of text.
 *
 * Thermal cutters sit a short distance beyond the print head, so a page that
 * ends exactly at the last character gets cut through it. This is the gap that
 * gives the blade somewhere to land.
 */
export const CUT_CLEARANCE_MM = 5;

/** A measured height in CSS pixels, as the page height in whole millimetres. */
export function pageHeightMm(px) {
  return Math.ceil(pxToMm(px)) + CUT_CLEARANCE_MM;
}

/**
 * Build the print rules for a set of measured copies.
 *
 * `copies` is `[{ type, mm }]` — one per receipt actually being printed.
 *
 * The rule that matters here is the default page size. `@page` sets one size
 * for the whole document, and the three copies are not the same length: the
 * kitchen copy carries no prices, so it has no subtotal, tax or total block and
 * is the shortest by some way. Sizing the job from the first copy — which is
 * what this used to do — set every page to the shortest receipt, and the taller
 * two ran off the bottom onto a second page.
 *
 * So each copy gets a named page at its own height, and the default is the
 * *tallest* of them. If named pages are ever unsupported, the `page` property
 * is ignored and every copy falls back to the default: some blank roll after
 * the short ones, rather than a receipt torn in half. Degrading to wasteful
 * beats degrading to wrong.
 */
export function buildPageCss(roll, copies) {
  const measured = (copies || []).filter(c => c && Number(c.mm) > 0);
  if (!measured.length) return null;

  const tallest = measured.reduce((max, c) => Math.max(max, c.mm), 0);

  const named = measured
    .filter(c => c.type)
    .map(c => (
      `@page rcpt-${c.type} { size: ${roll.pageMm}mm ${c.mm}mm; margin: 0; }\n` +
      `.receipt-copy.copy-${c.type} { page: rcpt-${c.type}; }`
    ))
    .join('\n');

  return `@media print {\n@page { size: ${roll.pageMm}mm ${tallest}mm; margin: 0; }\n${named}\n}`;
}
