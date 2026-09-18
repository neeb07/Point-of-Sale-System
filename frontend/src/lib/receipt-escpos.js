/**
 * A receipt as a list of printer operations, one copy at a time.
 *
 * This is Receipt.jsx said a second way. That component draws the receipt as
 * HTML for the screen and for Windows page printing; this describes the same
 * receipt as a flat list of text lines with alignment and weight, for a
 * thermal printer that speaks ESC/POS and has no page at all — it prints the
 * lines it is sent, feeds the paper the height of those lines, and cuts.
 *
 * Why it exists: Windows page printing puts a printer driver between the
 * receipt and the paper, and a thermal driver has to map "a page 80mm wide and
 * 123mm long" onto whatever paper forms it knows about. Some do it; the
 * BlackCopper BC-87AC does not, and silently substitutes a fixed form — so the
 * roll feeds a full form's worth of blank paper around a receipt laid out for
 * a fraction of it. Speaking ESC/POS bypasses the page model entirely: there
 * is no form to substitute, because there is no page.
 *
 * Pure. Takes the same `orderData` the modal already has, plus the settings it
 * would otherwise read from context, and returns ops. Money is formatted here
 * with the till's own formatMoney so the paper reads the same as the screen.
 *
 * Ops are deliberately dumb: { t: 'text' | 'feed' | 'cut' | 'rule' }. The
 * encoder in electron/escpos.js turns them into bytes; keeping the two apart
 * means this file can be tested without a printer and that one without a
 * receipt.
 */

/** 80mm rolls print 48 columns in the standard font; 58mm rolls print 32. */
export const COLUMNS = { '80mm': 48, '58mm': 32 };

export const COPY_LABELS = {
  kitchen: 'KITCHEN COPY',
  customer: 'CUSTOMER COPY',
  restaurant: 'RESTAURANT COPY',
};

/** Printed at the bottom of every receipt, and not configurable. Same text as Receipt.jsx. */
export const SOFTWARE_BY = [
  'POS Software By:',
  'Virtiqo (Private) Limited +92 300 8536046',
  'info@virtiqo.com',
];

const text = (v, o = {}) => ({ t: 'text', v: String(v ?? ''), ...o });

/** Word-wrap to a width. A word longer than the width is broken hard rather than lost. */
function wrap(str, width) {
  const out = [];
  for (const piece of String(str).split('\n')) {
    let cur = '';
    for (const w of piece.split(' ')) {
      let word = w;
      while (word.length > width) {
        if (cur) { out.push(cur); cur = ''; }
        out.push(word.slice(0, width));
        word = word.slice(width);
      }
      if ((cur + ' ' + word).trim().length > width && cur) { out.push(cur); cur = word; }
      else cur = (cur + ' ' + word).trim();
    }
    out.push(cur);
  }
  return out;
}
const feed = (n = 1) => ({ t: 'feed', n });
const rule = (ch = '-') => ({ t: 'rule', ch });
const cut = () => ({ t: 'cut' });

/** Left and right on one line, padded to the column width; wraps left if it must. */
function twoCol(left, right, columns) {
  const r = String(right ?? '');
  const room = Math.max(1, columns - r.length - 1);
  const l = String(left ?? '');
  if (l.length <= room) return l + ' '.repeat(columns - l.length - r.length) + r;
  // Too long to share a line: the left part wraps, the right sits on its own
  // last line so the figure is never split from its label by more than a row.
  return l + '\n' + ' '.repeat(columns - r.length) + r;
}

/**
 * An item row: name, quantity, and amount if prices are shown.
 *
 * Widths follow the HTML table — the quantity gets a fixed slot, the amount a
 * fixed right-aligned slot, and the name takes the rest, wrapping onto a second
 * line rather than being truncated. A name cut off mid-word was the original
 * complaint against the page-printed receipt.
 */
function itemRow(item, columns, showPrices, formatMoney) {
  const qty = `x${item.quantity}`;
  const amount = showPrices ? formatMoney(Number(item.price) * Number(item.quantity)) : '';
  const qtyW = 4;
  const amtW = showPrices ? Math.max(10, amount.length + 1) : 0;
  const nameW = columns - qtyW - amtW - 1;

  const words = String(item.name || '').split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > nameW && cur) { lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);

  const out = [];
  lines.forEach((ln, i) => {
    const first = i === 0;
    const q = first ? qty.padStart(qtyW) : ' '.repeat(qtyW);
    const a = showPrices ? (first ? amount.padStart(amtW) : ' '.repeat(amtW)) : '';
    out.push(text(ln.padEnd(nameW) + ' ' + q + a));
  });
  // What a deal is made of, indented under it. Wrapped to the name column so
  // a long dish never runs under the quantity.
  (item.contents || []).forEach((c) => {
    const label = `${c.quantity > 1 ? `${c.quantity} x ` : ''}${c.name}`;
    wrap(label, nameW - 4).forEach((piece, i) => out.push(text((i === 0 ? '  - ' : '    ') + piece)));
  });
  return out;
}

/**
 * The ops for one copy.
 *
 * `settings` is the slice of the settings context the HTML receipt reads:
 * formatMoney, showTax, showCashier, showOrderNumber, showPayment, paperSize.
 */
export function receiptOps(orderData, copyType, settings) {
  const {
    formatMoney = (n) => String(n),
    showTax = true, showCashier = true, showOrderNumber = true, showPayment = true,
    paperSize = '80mm',
  } = settings || {};
  const columns = COLUMNS[paperSize] || COLUMNS['80mm'];
  const d = orderData || {};
  const info = d.orderInfo || {};
  const restaurant = d.restaurant || {};
  const showPrices = copyType !== 'kitchen';
  const provisional = Boolean(info.provisional);
  const update = info.update || null;

  const ops = [];

  // --- copy banner ---------------------------------------------------------
  // Says which copy this is, and — on the two that carry money — whether it is
  // a paid bill. The kitchen never sees money, so its banner is left alone.
  const banner = update
    ? `${COPY_LABELS[copyType]} - UPDATED ORDER`
    : provisional && copyType !== 'kitchen'
      ? `${COPY_LABELS[copyType]} - PROVISIONAL, NOT PAID`
      : COPY_LABELS[copyType];
  ops.push(text(banner, { align: 'center', bold: true }));
  ops.push(rule('='));
  if (update) {
    // Large, so the kitchen cannot mistake it for a new order.
    ops.push(text('UPDATED ORDER', { align: 'center', bold: true, size: 'wide' }));
    ops.push(text(String(info.orderNumber || ''), { align: 'center', bold: true }));
    ops.push(text('Only the changes are listed below', { align: 'center' }));
  }

  // --- header --------------------------------------------------------------
  ops.push(text(restaurant.name || 'Restaurant', { align: 'center', bold: true, size: 'wide' }));
  if (restaurant.tagline) ops.push(text(restaurant.tagline, { align: 'center' }));
  if (restaurant.address) ops.push(text(restaurant.address, { align: 'center' }));
  if (restaurant.phone) ops.push(text(restaurant.phone, { align: 'center' }));
  ops.push(feed());

  // --- meta ----------------------------------------------------------------
  ops.push(text(twoCol(`Date: ${info.date || ''}`, `Time: ${info.time || ''}`, columns)));
  const rightMeta = [];
  if (showCashier && info.cashier) rightMeta.push(`Cashier: ${info.cashier}`);
  if (showOrderNumber && info.orderNumber) ops.push(text(`Order #: ${info.orderNumber}`));
  rightMeta.forEach(m => ops.push(text(m)));
  ops.push(text(twoCol(`Table: ${info.table || '-'}`, info.orderType ? `Type: ${info.orderType}` : '', columns)));
  if (showPayment && info.paymentMethod) ops.push(text(`Payment: ${info.paymentMethod}`));

  // --- delivery ------------------------------------------------------------
  const c = d.customer || {};
  if (c.name || c.phone || c.address) {
    ops.push(rule());
    ops.push(text('DELIVER TO', { bold: true }));
    if (c.name) ops.push(text(c.name, { bold: true }));
    if (c.phone) ops.push(text(c.phone));
    if (c.address) ops.push(text(c.address));
  }

  // --- items ---------------------------------------------------------------
  ops.push(rule());
  if (update) {
    // The changes only: what to add to the order, and what to take off it.
    if ((d.items || []).length) {
      ops.push(text('ADDED', { bold: true }));
      ops.push(text(twoCol('ITEM', 'QTY', columns), { bold: true }));
      ops.push(rule());
      (d.items || []).forEach((item) => {
        itemRow(item, columns, false, formatMoney).forEach(op => ops.push(op));
      });
    }
    if ((update.removed || []).length) {
      if ((d.items || []).length) ops.push(rule());
      ops.push(text('REMOVED - DO NOT MAKE', { bold: true }));
      ops.push(rule());
      update.removed.forEach((item) => {
        itemRow(item, columns, false, formatMoney).forEach(op => ops.push(op));
      });
    }
  } else {
    const head = showPrices
      ? twoCol('ITEM', 'QTY   AMOUNT', columns)
      : twoCol('ITEM', 'QTY', columns);
    ops.push(text(head, { bold: true }));
    ops.push(rule());
    (d.items || []).forEach((item) => {
      itemRow(item, columns, showPrices, formatMoney).forEach(op => ops.push(op));
    });
  }

  // --- totals (not on the kitchen copy) ------------------------------------
  if (showPrices) {
    ops.push(rule());
    ops.push(text(twoCol('Subtotal', formatMoney(d.subtotal || 0), columns)));
    if (Number(d.discount) > 0) {
      ops.push(text(twoCol('Discount', '-' + formatMoney(d.discount), columns)));
    }
    if (Number(d.employeeDiscount) > 0) {
      const rate = d.employeeDiscountRate ? ` (${d.employeeDiscountRate}%)` : '';
      ops.push(text(twoCol(`Staff Discount${rate}`, '-' + formatMoney(d.employeeDiscount), columns)));
    }
    if (showTax && Number(d.taxAmount) > 0) {
      const rate = d.taxRate ? ` (${d.taxRate}%)` : '';
      ops.push(text(twoCol(`Tax${rate}`, formatMoney(d.taxAmount, { decimals: d.taxAmount % 1 !== 0 }), columns)));
    }
    if (Number(d.deliveryCharge) > 0 || info.orderType === 'Delivery') {
      ops.push(text(twoCol('Delivery', formatMoney(d.deliveryCharge || 0), columns)));
    }
    ops.push(rule('='));
    ops.push(text(twoCol('TOTAL', formatMoney(d.total || 0), columns), { bold: true, size: 'tall' }));
    ops.push(rule('='));
  } else {
    ops.push(rule());
  }

  // --- footer --------------------------------------------------------------
  ops.push(feed());
  ops.push(text(restaurant.footerMessage || 'Thank you for visiting!', { align: 'center', bold: true }));
  ops.push(rule());
  SOFTWARE_BY.forEach((line, i) => ops.push(text(line, { bold: i === 0 })));

  // Room for the blade, then the cut. A cut that lands on the last line of
  // text is the thermal equivalent of a page that ends mid-sentence.
  ops.push(feed(3));
  ops.push(cut());

  /*
   * Nothing wider than the roll leaves this function.
   *
   * The two-column rows above already fit; free text — the shop's address,
   * the maker's line, a long footer — is wrapped here on word boundaries, at
   * half width for double-width lines. The encoder wraps too, as a last
   * resort, but the guarantee belongs where the receipt is composed so it can
   * be checked without a printer.
   */
  return ops.flatMap((op) => {
    if (op.t !== 'text') return [op];
    const width = op.size === 'wide' ? Math.floor(columns / 2) : columns;
    // A line that already fits is left exactly as it is. Wrapping rejoins
    // words with single spaces, which would collapse the run of spaces that
    // right-aligns a figure in a two-column row — so only overflow is wrapped.
    const pieces = String(op.v).split('\n');
    const parts = pieces.flatMap(piece => (piece.length <= width ? [piece] : wrap(piece, width)));
    return parts.map(v => ({ ...op, v }));
  });
}

/** All requested copies, each ending in its own cut. */
export function receiptJob(orderData, copies, settings) {
  return (copies || []).flatMap(copy => receiptOps(orderData, copy, settings));
}
