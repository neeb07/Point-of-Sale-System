/**
 * Receipt ops → ESC/POS bytes.
 *
 * ESC/POS is the command language nearly every receipt printer understands:
 * plain text, with escape sequences for alignment, weight, size, feeding and
 * cutting. There is no page. The printer prints what it is sent and stops.
 * That is the whole reason this path exists — see src/lib/receipt-escpos.js.
 *
 * Pure: bytes in, bytes out, nothing touched. Testable without a printer.
 *
 * Only the commands in the common subset are used — the ones an Epson TM-T88
 * accepts, which every clone of it accepts too. Nothing model-specific.
 */

const ESC = 0x1b;
const GS = 0x1d;

const CMD = {
  init: [ESC, 0x40],                  // ESC @   reset to defaults
  alignLeft: [ESC, 0x61, 0x00],       // ESC a 0
  alignCenter: [ESC, 0x61, 0x01],     // ESC a 1
  alignRight: [ESC, 0x61, 0x02],      // ESC a 2
  boldOn: [ESC, 0x45, 0x01],          // ESC E 1
  boldOff: [ESC, 0x45, 0x00],         // ESC E 0
  sizeNormal: [GS, 0x21, 0x00],       // GS ! 0
  sizeTall: [GS, 0x21, 0x01],         // GS ! 1   double height
  sizeWide: [GS, 0x21, 0x11],         // GS ! 17  double height and width
  lf: [0x0a],
  // GS V 66 n: partial cut, after feeding n dots — "feed then cut" in one
  // command, which is the form the widest range of printers honours.
  cut: [GS, 0x56, 0x42, 0x00],
};

/**
 * ESC/POS printers default to code page 437, which has no em dash, curly
 * quotes, multiplication sign or rupee sign. Anything outside ASCII either
 * prints as a wrong glyph or, on some firmware, throws the whole line off. So
 * the few characters the receipt actually uses are mapped to ASCII
 * equivalents, and anything else non-ASCII becomes '?' rather than a gamble.
 */
const ASCII_MAP = {
  '—': '-', '–': '-', '‒': '-',
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '×': 'x', '•': '*', '…': '...',
  '₨': 'Rs', '₹': 'Rs',
  ' ': ' ',
};

function toAscii(s) {
  let out = '';
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (code < 0x80) out += ch;
    else if (ASCII_MAP[ch] !== undefined) out += ASCII_MAP[ch];
    else out += '?';
  }
  return out;
}

/**
 * Encode a list of ops as one job.
 *
 * `columns` is the printable width in characters at normal size; a rule fills
 * it and a wide line halves it. The caller knows the roll; this does not.
 */
function encode(ops, { columns = 48 } = {}) {
  const bytes = [...CMD.init];
  let align = 'left';
  let bold = false;
  let size = 'normal';

  const setAlign = (a) => {
    if (a === align) return;
    align = a;
    bytes.push(...(a === 'center' ? CMD.alignCenter : a === 'right' ? CMD.alignRight : CMD.alignLeft));
  };
  const setBold = (b) => {
    if (b === bold) return;
    bold = b;
    bytes.push(...(b ? CMD.boldOn : CMD.boldOff));
  };
  const setSize = (s) => {
    if (s === size) return;
    size = s;
    bytes.push(...(s === 'wide' ? CMD.sizeWide : s === 'tall' ? CMD.sizeTall : CMD.sizeNormal));
  };
  const line = (s) => {
    for (const ch of toAscii(s)) bytes.push(ch.charCodeAt(0));
    bytes.push(...CMD.lf);
  };

  for (const op of ops || []) {
    switch (op.t) {
      case 'text': {
        setAlign(op.align || 'left');
        setBold(Boolean(op.bold));
        setSize(op.size || 'normal');
        // A wide line has half the columns; long ones wrap by the printer
        // itself, which is ugly, so they are wrapped here on word boundaries.
        const width = op.size === 'wide' ? Math.floor(columns / 2) : columns;
        for (const piece of String(op.v).split('\n')) {
          if (piece.length <= width) { line(piece); continue; }
          let cur = '';
          for (const w of piece.split(' ')) {
            if ((cur + ' ' + w).trim().length > width && cur) { line(cur); cur = w; }
            else cur = (cur + ' ' + w).trim();
          }
          if (cur) line(cur);
        }
        break;
      }
      case 'rule':
        setAlign('left'); setBold(false); setSize('normal');
        line((op.ch || '-').repeat(columns));
        break;
      case 'feed':
        for (let i = 0; i < (op.n || 1); i++) bytes.push(...CMD.lf);
        break;
      case 'cut':
        // Reset styling before the cut so the next copy starts clean even if
        // the printer's firmware does not clear it on GS V.
        setAlign('left'); setBold(false); setSize('normal');
        bytes.push(...CMD.cut);
        break;
      default:
        break;
    }
  }

  return Buffer.from(bytes);
}

module.exports = { encode, toAscii, CMD };
