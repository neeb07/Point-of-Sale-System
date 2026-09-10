/**
 * The page rules that decide how much roll comes out.
 *
 *   cd frontend
 *   node test/print-page.mjs
 *
 * No browser and no printer. Measuring a receipt needs a DOM; deciding what to
 * do with the measurements does not, and the deciding is where the bug was —
 * three copies of three different lengths were all being printed at the length
 * of the shortest one.
 */
import { ROLLS, rollFor, pxToMm, pageHeightMm, buildPageCss, CUT_CLEARANCE_MM }
  from '../src/lib/print-page.js';

let failures = 0;
const ok = (label, cond) => {
  if (!cond) failures += 1;
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + label);
};

console.log('=== THE ROLL ===');
ok('80mm is the default for anything unrecognised', rollFor(undefined).pageMm === 80);
ok('and for a blank setting', rollFor('').pageMm === 80);
ok('58mm is honoured when it is asked for', rollFor('58mm').pageMm === 58);
// The page is the paper; the content strip is narrower because the print head
// cannot reach the edges. Getting these the same way round clips every line.
ok('the content strip is narrower than the paper on 80mm',
   ROLLS['80mm'].contentMm < ROLLS['80mm'].pageMm);
ok('and on 58mm', ROLLS['58mm'].contentMm < ROLLS['58mm'].pageMm);
ok('80mm prints 72mm wide', ROLLS['80mm'].contentMm === 72);

console.log();
console.log('=== MILLIMETRES ===');
// 96 CSS px is one inch by definition, so this is exact rather than a fudge.
ok('96px is exactly one inch', Math.abs(pxToMm(96) - 25.4) < 1e-9);
ok('a page is the content plus room for the blade',
   pageHeightMm(96) === Math.ceil(25.4) + CUT_CLEARANCE_MM);
ok('and never shorter than the content', pageHeightMm(500) >= pxToMm(500));

console.log();
console.log('=== THREE COPIES OF THREE DIFFERENT LENGTHS ===');
/*
 * The real shape of the bug. A kitchen copy has no prices and so no totals
 * block, which makes it much the shortest; the customer and restaurant copies
 * carry the money and are taller.
 */
const copies = [
  { type: 'kitchen', mm: 110 },
  { type: 'customer', mm: 150 },
  { type: 'restaurant', mm: 148 },
];
const css = buildPageCss(rollFor('80mm'), copies);
console.log(css.split('\n').map(l => '   ' + l).join('\n'));

ok('each copy gets its own page height',
   css.includes('@page rcpt-kitchen { size: 80mm 110mm; margin: 0; }') &&
   css.includes('@page rcpt-customer { size: 80mm 150mm; margin: 0; }') &&
   css.includes('@page rcpt-restaurant { size: 80mm 148mm; margin: 0; }'));
ok('and is pointed at it', css.includes('.receipt-copy.copy-customer { page: rcpt-customer; }'));

/*
 * The safety property, and the one that was violated.
 *
 * If named pages are ever unsupported the `page` property is ignored and every
 * copy falls back to the default. That default must be the TALLEST copy: too
 * tall wastes a little roll, too short tears a receipt in half across a cut.
 */
ok('the fallback page is the tallest copy, not the first',
   css.includes('@page { size: 80mm 150mm; margin: 0; }'));
ok('so no copy can be taller than the page it falls back to',
   copies.every(c => c.mm <= 150));

console.log();
console.log('=== ONE COPY AT A TIME ===');
// A reprint of a single copy. This always worked, and must keep working.
const one = buildPageCss(rollFor('80mm'), [{ type: 'customer', mm: 150 }]);
ok('the page is exactly that copy', one.includes('@page { size: 80mm 150mm; margin: 0; }'));

console.log();
console.log('=== NOTHING TO PRINT ===');
ok('no copies produces no rule at all, rather than a zero-height page',
   buildPageCss(rollFor('80mm'), []) === null);
ok('and neither do copies that measured nothing',
   buildPageCss(rollFor('80mm'), [{ type: 'kitchen', mm: 0 }]) === null);
// A copy with no type still counts toward the page size even though it gets no
// named rule — otherwise it would print at somebody else's height.
const untyped = buildPageCss(rollFor('80mm'), [{ type: '', mm: 200 }]);
ok('an untyped copy still sets the page', untyped.includes('size: 80mm 200mm'));

console.log();
console.log('=== 58mm ROLLS ===');
const narrow = buildPageCss(rollFor('58mm'), copies);
ok('every page is 58mm wide', (narrow.match(/size: 58mm/g) || []).length === 4);
ok('and none of them 80mm', !narrow.includes('80mm'));

console.log();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
