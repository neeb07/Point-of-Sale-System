/**
 * The receipt as ESC/POS — the ops, the bytes, and the delivery script.
 *
 *   cd frontend
 *   node test/receipt-escpos.mjs
 *
 * No printer. The ops builder and the encoder are pure, so the whole receipt
 * can be checked byte by byte; the spooler script is exercised only as far as
 * its refusal of a printer that does not exist, which is the failure the till
 * has to handle cleanly.
 */
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { receiptOps, receiptJob, COLUMNS, SOFTWARE_BY } from '../src/lib/receipt-escpos.js';

const require = createRequire(import.meta.url);
const { encode, toAscii, CMD } = require('../electron/escpos.js');

let failures = 0;
const ok = (label, cond) => { if (!cond) failures += 1; console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + label); };

const formatMoney = (n, { decimals = false } = {}) =>
  'Rs ' + (decimals ? Number(n).toFixed(2) : Math.round(Number(n)).toLocaleString('en-US'));
const settings = { formatMoney, showTax: true, showCashier: true, showOrderNumber: true, showPayment: true, paperSize: '80mm' };

const order = {
  orderInfo: { date: '16/09/2026', time: '07:12 PM', orderNumber: 'E-18-061', table: '7',
               paymentMethod: 'Cash', cashier: 'Junaid', orderType: 'Dine-in' },
  items: [
    { name: 'Crunchy Pizza (X-Large)', quantity: 1, price: 2050 },
    { name: 'Nuggets (12 Pieces) with extra honey mustard dip on the side', quantity: 2, price: 450 },
  ],
  subtotal: 2950, discount: 0, employeeDiscount: 0, employeeDiscountRate: 0, isEmployee: false,
  taxRate: 5, taxAmount: 147.5, deliveryCharge: 0, total: 3097.5,
  restaurant: { name: 'Blaze Pizza House', tagline: 'House of Delicious Foods',
                address: 'E-18 Islamabad, Pakistan', phone: '0323 4441129', footerMessage: 'Thank you for visiting!' },
  customer: { name: '', phone: '', address: '' },
};
const lines = (ops) => ops.filter(o => o.t === 'text').map(o => o.v);

console.log('=== THE KITCHEN COPY ===');
const kitchen = receiptOps(order, 'kitchen', settings);
const kText = lines(kitchen).join('\n');
ok('says which copy it is', kText.includes('KITCHEN COPY'));
ok('names the shop', kText.includes('Blaze Pizza House'));
ok('lists every item', kText.includes('Crunchy Pizza') && kText.includes('Nuggets'));
ok('with quantities', /x1/.test(kText) && /x2/.test(kText));
// The kitchen never sees money — the one rule the HTML receipt enforces most carefully.
ok('and no prices at all', !/Rs /.test(kText) && !/TOTAL/.test(kText) && !/Subtotal/.test(kText));
ok('ends with a cut', kitchen[kitchen.length - 1].t === 'cut');
ok('after room for the blade', kitchen[kitchen.length - 2].t === 'feed' && kitchen[kitchen.length - 2].n >= 2);

console.log();
console.log('=== THE CUSTOMER COPY ===');
const customer = receiptOps(order, 'customer', settings);
const cText = lines(customer).join('\n');
ok('carries the prices', cText.includes('Rs 2,050') && cText.includes('Rs 900'));
ok('the subtotal', cText.includes('Subtotal') && cText.includes('Rs 2,950'));
ok('the tax with its rate', cText.includes('Tax (5%)') && cText.includes('Rs 147.50'));
ok('and the total, emphasised', customer.some(o => o.t === 'text' && /TOTAL/.test(o.v) && o.bold && o.size === 'tall'));
ok('the order number', cText.includes('Order #: E-18-061'));
ok('the maker line, unchanged', SOFTWARE_BY.every(l => cText.includes(l)));
ok('not marked provisional', !/PROVISIONAL/.test(cText));

console.log();
console.log('=== EVERY LINE FITS THE ROLL ===');
const tooWide = lines(customer).flatMap(l => l.split('\n')).filter(l => l.length > COLUMNS['80mm']);
ok('no line is wider than 48 columns', tooWide.length === 0);
if (tooWide.length) tooWide.forEach(l => console.log('    too wide: ' + JSON.stringify(l)));
ok('a long item name wraps rather than truncates',
   lines(customer).some(l => /Nuggets/.test(l)) && cText.includes('mustard'));
const totalLine = lines(customer).find(l => /^TOTAL/.test(l));
ok('the total is right-aligned to the edge', totalLine && totalLine.length === COLUMNS['80mm'] && totalLine.endsWith('Rs 3,098'));

console.log();
console.log('=== A HELD TICKET IS NOT A BILL ===');
const held = { ...order, orderInfo: { ...order.orderInfo, orderNumber: 'Ticket H-7', paymentMethod: 'Not yet paid', provisional: true } };
const heldCustomer = lines(receiptOps(held, 'customer', settings)).join('\n');
const heldKitchen = lines(receiptOps(held, 'kitchen', settings)).join('\n');
ok('the customer copy says PROVISIONAL, NOT PAID', /PROVISIONAL, NOT PAID/.test(heldCustomer));
ok('the kitchen copy does not', !/PROVISIONAL/.test(heldKitchen));

console.log();
console.log('=== AN UPDATED TICKET TELLS THE KITCHEN ONLY WHAT CHANGED ===');
const updated = { ...order,
  orderInfo: { ...order.orderInfo, orderNumber: 'Ticket H-7', provisional: true,
               update: { removed: [{ name: 'Crunchy Pizza (X-Large)', quantity: 1 }] } },
  items: [{ name: 'Alfredo Pasta', quantity: 1, price: 0 }] };
const uOps = receiptOps(updated, 'kitchen', settings);
const uText = lines(uOps).join(String.fromCharCode(10));
ok('says UPDATED ORDER in the banner', /KITCHEN COPY - UPDATED ORDER/.test(uText));
ok('and again, large', uOps.some(o => o.t === 'text' && o.v === 'UPDATED ORDER' && o.size === 'wide'));
ok('with the ticket number', uText.includes('Ticket H-7'));
ok('lists the new dish under ADDED', uText.indexOf('ADDED') < uText.indexOf('Alfredo Pasta'));
ok('and the dropped one under REMOVED', uText.indexOf('REMOVED') < uText.indexOf('Crunchy Pizza') && uText.indexOf('REMOVED') > uText.indexOf('Alfredo Pasta'));
ok('with no prices', !/Rs /.test(uText));

console.log();
console.log('=== A DEAL SAYS WHAT IS INSIDE IT ===');
const withDeal = { ...order, items: [
  { name: 'Pizza Deal 2 (Tikka)', quantity: 1, price: 1800,
    contents: [{ name: 'Chicken Tikka Pizza (Large)', quantity: 1 }, { name: 'Hot Wings', quantity: 6 }, { name: 'Soft Drink 1.5L', quantity: 1 }] },
] };
const dealText = lines(receiptOps(withDeal, 'kitchen', settings)).join(String.fromCharCode(10));
ok('the deal line is there', dealText.includes('Pizza Deal 2'));
ok('and each dish inside it, indented', dealText.includes(String.fromCharCode(10) + '  - Chicken Tikka Pizza') && /- 6 x Hot Wings/.test(dealText) && /- Soft Drink/.test(dealText));
ok('within the roll width', lines(receiptOps(withDeal, 'customer', settings)).every(l => l.length <= 48));

console.log();
console.log('=== A DELIVERY ORDER ===');
const delivery = { ...order,
  orderInfo: { ...order.orderInfo, orderType: 'Delivery' }, deliveryCharge: 150,
  customer: { name: 'Sana Iqbal', phone: '0300-7654321', address: 'House 9, Street 3, F-10' } };
const dText = lines(receiptOps(delivery, 'customer', settings)).join('\n');
ok('prints where it is going', /DELIVER TO/.test(dText) && dText.includes('Sana Iqbal') && dText.includes('F-10'));
ok('and the delivery charge', /Delivery/.test(dText) && dText.includes('Rs 150'));

console.log();
console.log('=== THREE COPIES, ONE JOB, THREE CUTS ===');
const job = receiptJob(order, ['kitchen', 'customer', 'restaurant'], settings);
ok('three cuts', job.filter(o => o.t === 'cut').length === 3);
ok('in order', (() => { const t = lines(job).join('\n'); return t.indexOf('KITCHEN') < t.indexOf('CUSTOMER') && t.indexOf('CUSTOMER') < t.indexOf('RESTAURANT'); })());

console.log();
console.log('=== THE BYTES ===');
const bytes = encode(job, { columns: 48 });
const hex = (arr) => Buffer.from(arr).toString('hex');
ok('starts by resetting the printer (ESC @)', bytes.subarray(0, 2).toString('hex') === hex(CMD.init));
ok('ends with a cut (GS V 66 0)', bytes.subarray(-4).toString('hex') === hex(CMD.cut));
ok('cuts three times', bytes.toString('latin1').split(Buffer.from(CMD.cut).toString('latin1')).length - 1 === 3);
ok('turns bold on for the total', bytes.toString('latin1').includes(Buffer.from(CMD.boldOn).toString('latin1')));
ok('uses double height for the total', bytes.toString('latin1').includes(Buffer.from(CMD.sizeTall).toString('latin1')));
ok('centres the header', bytes.toString('latin1').includes(Buffer.from(CMD.alignCenter).toString('latin1')));
ok('the shop name survives as text', bytes.toString('latin1').includes('Blaze Pizza House'));
ok('every byte is printable ASCII or a control code', [...bytes].every(b => b < 0x80));

console.log();
console.log('=== CHARACTERS THE PRINTER DOES NOT HAVE ===');
ok('em dash becomes a hyphen', toAscii('a — b') === 'a - b');
ok('curly quote becomes straight', toAscii('it’s') === "it's");
ok('multiplication sign becomes x', toAscii('2×3') === '2x3');
ok('anything else becomes ? rather than garbage', toAscii('café') === 'caf?');
ok('plain ASCII is untouched', toAscii('Rs 1,234.50') === 'Rs 1,234.50');

console.log();
console.log('=== 58mm ROLLS ===');
const narrow = receiptOps(order, 'customer', { ...settings, paperSize: '58mm' });
ok('every line fits 32 columns', lines(narrow).flatMap(l => l.split('\n')).every(l => l.length <= 32));

console.log();
console.log('=== THE SPOOLER SCRIPT REFUSES A PRINTER THAT DOES NOT EXIST ===');
if (process.platform === 'win32') {
  const tmp = path.join(os.tmpdir(), 'blaze-escpos-test.bin');
  fs.writeFileSync(tmp, bytes);
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.resolve('electron/rawprint.ps1'), '-Printer', 'No Such Printer 9f2a', '-File', tmp],
    { encoding: 'utf8', timeout: 30000 });
  fs.unlinkSync(tmp);
  console.log('   exit ' + r.status + ': ' + (r.stderr || r.stdout).trim().split('\n')[0]);
  ok('a wrong printer name fails with a non-zero exit and a reason', r.status !== 0 && /OpenPrinter failed/.test(r.stderr || ''));
  ok('rather than hanging or throwing', r.error === undefined);
} else {
  console.log('   (Windows only — skipped)');
}

console.log();
console.log(failures ? failures + ' FAILED' : 'all passed');
process.exit(failures ? 1 : 0);
