/**
 * CSV export.
 *
 * Two things this has to get right, both of which are easy to get wrong and
 * silently damaging:
 *
 * **Escaping.** A field containing a comma, a quote or a newline must be quoted
 * and its quotes doubled (RFC 4180). A customer address with a comma in it
 * would otherwise shift every column after it, one row at a time, and the file
 * still opens.
 *
 * **Formula injection.** A cell beginning `=`, `+`, `-` or `@` is executed by
 * Excel as a formula when the file is opened. A customer name is attacker-
 * controlled text that ends up in a spreadsheet on the owner's machine, so it
 * is prefixed with a tab to defuse it.
 */

function escapeCell(value) {
  if (value == null) return '';
  let s = String(value);

  if (/^[=+\-@]/.test(s)) s = '\t' + s;

  if (/[",\n\r\t]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function buildCsv(rows) {
  // A BOM, so Excel opens it as UTF-8 rather than mangling every non-ASCII
  // character in a customer's name or address.
  return '﻿' + rows.map(r => r.map(escapeCell).join(',')).join('\r\n');
}

export function downloadCsv(filename, rows) {
  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
