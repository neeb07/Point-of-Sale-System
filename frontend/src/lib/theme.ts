/**
 * Blaze POS — central design tokens.
 *
 * Every brand colour lives here. Do NOT hardcode hex values in components;
 * import from this file so a future rebrand is a one-file change.
 *
 * Palette rationale
 * -----------------
 *  - BLACK  is the primary action colour (Charge, Save, Confirm).
 *  - RED    is the brand accent (active tabs, active nav, totals, focus).
 *  - CREAM  is the warm surface tint that replaces the old orange washes.
 *
 * Destructive actions stay red but are ALWAYS outline-only, never filled,
 * so a solid red button is never a delete.
 */

export const COLORS = {
  // ── Brand ────────────────────────────────────────────────────────────────
  brand: '#DC2626', // primary red — accents, active states, totals
  brandDark: '#B91C1C', // hover / pressed red
  brandTint: '#FEEFD0', // warm cream — active tab backgrounds, soft panels
  brandTintSoft: '#FFF9EE', // lighter cream — hover washes
  brandBorder: '#F2D9A0', // cream border to pair with brandTint

  // ── Ink (black scale) ────────────────────────────────────────────────────
  ink: '#111111', // primary buttons, headings
  inkHover: '#000000', // primary button hover
  inkBody: '#1F1F1F', // body text
  inkMuted: '#6B6B63', // secondary text
  inkFaint: '#A3A39A', // tertiary text
  inkDisabled: '#BCBCB4', // disabled text / icons

  // ── Surfaces ─────────────────────────────────────────────────────────────
  surface: '#FFFFFF',
  surfaceAlt: '#FAF8F3', // slightly warm off-white panels
  surfaceSunken: '#F5F2EA', // app background
  border: '#E8E4DA',
  borderStrong: '#D8D2C4',

  // ── Semantic ─────────────────────────────────────────────────────────────
  danger: '#DC2626', // same red — but outline-only usage
  dangerTint: '#FEF2F2',
  dangerBorder: '#FECACA',
  success: '#16A34A',
  successTint: '#F0FDF4',
  warning: '#B45309',
  warningTint: '#FEEFD0',
} as const;

/** Chart / data-viz palette — red-led, black-anchored, cream-warmed. */
export const CHART_COLORS = [
  '#DC2626',
  '#111111',
  '#E8A33D',
  '#7F1D1D',
  '#6B7280',
  '#B45309',
];

/** Staff avatar palette (Cashier screen). */
export const AVATAR_COLORS = [
  '#DC2626',
  '#111111',
  '#B45309',
  '#7F1D1D',
  '#4B5563',
  '#E8A33D',
];

/** Shared shadows so elevation is consistent. */
export const SHADOWS = {
  card: '0 1px 3px rgba(17,17,17,0.06)',
  cardHover: '0 4px 14px rgba(17,17,17,0.10)',
  brand: '0 2px 8px rgba(220,38,38,0.28)',
  ink: '0 2px 8px rgba(17,17,17,0.22)',
  modal: '0 10px 25px rgba(17,17,17,0.14)',
} as const;

/** Restaurant identity fallbacks (real values come from /api/settings). */
export const BRAND = {
  name: 'Blaze',
  productName: 'Blaze POS',
} as const;

export default COLORS;
