/**
 * The order number people say out loud.
 *
 * One shop could get away with "order 41". Two cannot: each till numbers its
 * own orders from 1, so on any given day both branches have an order 41, and a
 * customer ringing about "order 41" is asking about one of two different sales.
 *
 * So the branch's short code goes in front, and the number is padded to three
 * digits: E-18-041, LR-007. Padding is cosmetic but worth having — it
 * keeps a printed list aligned and makes a transposed digit visible.
 *
 * This is a *label*, not a key. The row's integer id is unchanged and remains
 * what the cloud is keyed on, as (branch_id, local_id). Two consequences worth
 * being explicit about:
 *
 *   - Renaming a branch, or editing its code, changes how existing orders are
 *     written down. Nothing is renumbered and no history moves.
 *   - Past the thousandth order the padding simply stops padding — E-18-1004 —
 *     rather than wrapping or truncating. A number that grows a digit is fine;
 *     one that silently repeats is not.
 *
 * An order with no branch (an account that predates branches, or an owner's
 * sale attributed to no site) falls back to the bare number rather than
 * inventing a code that would collide with a real one.
 */

/** Pad to three, then let it grow. */
const pad = (n) => String(n).padStart(3, '0');

function formatOrderNo(code, id) {
  if (id == null) return '';
  const c = String(code == null ? '' : code).trim();
  return c ? `${c}-${pad(id)}` : String(id);
}

module.exports = { formatOrderNo };
