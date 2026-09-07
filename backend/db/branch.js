/**
 * Branch attribution and the delivery customer book.
 *
 * Both are small pieces of write-time bookkeeping that several routes need, so
 * they live here rather than being duplicated across orders and expenses.
 */
const db = require('./database');
const { tillBranchId } = require('./till-identity');

/**
 * Which branch a member of staff belongs to.
 *
 * Returns null when the account predates branches or the caller has no
 * session; a null branch simply means the row is not attributed to a site,
 * which reports treat as "unassigned" rather than dropping it.
 */
function branchIdForStaff(staffId) {
  if (!staffId) return null;
  const row = db.prepare('SELECT branch_id FROM staff WHERE id = ?').get(staffId);
  return (row && row.branch_id) || null;
}

/**
 * A branch's short code, for the order numbers on receipts.
 *
 * Prepared once here rather than looked up per order: the list endpoint would
 * otherwise run this for every row on the screen. There are two branches, so
 * the statement is effectively a two-row lookup table.
 */
const branchCodeRow = db.prepare('SELECT code FROM branches WHERE id = ?');
function branchCode(branchId) {
  if (!branchId) return null;
  const row = branchCodeRow.get(branchId);
  return (row && row.code) || null;
}

const normalisePhone = (v) => {
  const digits = String(v || '').replace(/\D/g, '');
  return digits.length ? digits : null;
};

const clean = (v) => {
  const t = String(v == null ? '' : v).trim();
  return t.length ? t : null;
};

/**
 * File a delivery customer, or update the one already on file.
 *
 * Matching is on the phone number first, because that is what actually
 * identifies a household: two different Ahmeds keep separate records, and the
 * same Ahmed ordering to his office instead of his house updates his record
 * rather than creating a second one. Where there is no phone we fall back to
 * an exact name-and-address match, which is the most we can safely infer.
 *
 * Comparison is on digits only, so 0300-1234567 and 03001234567 are the same
 * customer — otherwise a stray dash would quietly fork someone's history.
 *
 * Called inside the order transaction, so a failed order files no customer.
 */
function recordCustomer({ name, phone, address, total }) {
  const nm = clean(name);
  const ph = normalisePhone(phone);
  const addr = clean(address);

  // Nothing was entered — the cashier skipped the prompt.
  if (!nm && !ph && !addr) return null;

  const spend = Number(total) || 0;

  let existing = null;
  if (ph) {
    existing = db.prepare('SELECT id FROM customers WHERE phone = ?').get(ph);
  } else if (nm && addr) {
    existing = db.prepare(
      'SELECT id FROM customers WHERE phone IS NULL AND name = ? AND address = ?'
    ).get(nm, addr);
  }

  if (existing) {
    // COALESCE keeps what we already know when this order left a field blank,
    // so skipping the address on a repeat order does not erase it.
    db.prepare(`
      UPDATE customers
         SET name         = COALESCE(?, name),
             address      = COALESCE(?, address),
             order_count  = order_count + 1,
             total_spent  = total_spent + ?,
             last_order_at = datetime('now', 'localtime')
       WHERE id = ?
    `).run(nm, addr, spend, existing.id);
    return existing.id;
  }

  const r = db.prepare(`
    INSERT INTO customers (name, phone, address, order_count, total_spent, first_order_at, last_order_at)
    VALUES (?, ?, ?, 1, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
  `).run(nm, ph, addr, spend);
  return r.lastInsertRowid;
}

/**
 * The branch a row being written right now belongs to.
 *
 * The machine wins over the staff record, deliberately. A manager assigned to
 * E-18 who covers a shift at CBR Town is standing at the CBR Town drawer, and
 * that is CBR Town's cash — filing it under E-18 because of their staff record
 * would misstate both branches at once. The staff record is only a fallback for
 * a till that has not been paired to a branch, which is the normal state of a
 * single-shop install.
 *
 * Use this for every write. `branchIdForStaff` remains for the one job it is
 * still right for: asking which branch a *person* belongs to.
 */
function resolveBranchId(req) {
  return tillBranchId() || branchIdForStaff(req && req.user && req.user.staffId);
}

/**
 * The open shift belonging to a member of staff, if they have one.
 *
 * Sales and drawer payouts attach to the till the person is actually working,
 * not merely to whichever shift happens to be open. With two managers trading
 * at once the old global lookup filed one of them's takings against the
 * other's drawer, so neither could be reconciled.
 */
function openShiftIdFor(staffId) {
  if (!staffId) return null;
  const row = db.prepare(
    "SELECT id FROM shifts WHERE status = 'open' AND staff_id = ? ORDER BY opened_at DESC LIMIT 1"
  ).get(staffId);
  return row ? row.id : null;
}

module.exports = { branchIdForStaff, branchCode, resolveBranchId, recordCustomer, normalisePhone, openShiftIdFor };
