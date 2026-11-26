import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const html = readFileSync(new URL('../compare-prices.html', import.meta.url), 'utf8');
const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert(match, 'Missing Firestore module');
const src = match[1];

// Check the *whole* module syntax without downloading Firebase or starting a browser.
const folder = mkdtempSync(join(tmpdir(), 'compare-prices-share-'));
try {
  const path = join(folder, 'page.mjs');
  writeFileSync(path, src);
  const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
} finally {
  rmSync(folder, { recursive: true, force: true });
}

assert.doesNotMatch(html, /<script[^>]+src="[^"]*html2canvas/, 'Heavy DOM snapshot dependency must be removed');
assert.doesNotMatch(src, /\bprewarmReceipts\(|\bschedulePrewarm\(|\brenderChain\b/);
assert.match(src, /function finishShare\(\)/, 'Close share UI without waiting for Firestore');
assert.doesNotMatch(src, /await finishShare\(\)/);
assert.match(src, /if \(r === 'shared'\) finishShare\(\)/);
assert.match(src, /showShareReadyModal\(\);\s*\}\s*catch \(e\)/, 'Image must be ready before explicit user-triggered sharing');
assert.match(src, /function finishShare\(\)/, 'Share finalization handles confirmed save');
assert.match(src, /savePromise = addDoc\(collection\(db, 'purchase_orders'\), p\.orderDocData\)/,
  'Save should be started only from final share action');
assert.match(src, /console\.error\('تعذر حفظ الطلبية؛ بقيت السلة محفوظة:'/,
  'Failed writes must preserve the local cart');
const shareStart = src.indexOf('window.shareReceiptImage = async function');
const shareEnd = src.indexOf('window.openOrdersHistoryModal = async function', shareStart);
assert(shareStart >= 0 && shareEnd > shareStart, 'Share button flow missing');
assert.doesNotMatch(src.slice(shareStart, shareEnd), /addDoc\(/,
  'Preview or cancelled share should never cause a database write');
assert.match(src, /itemsSig\(cartOrders\[p\.supplierName\]\) === itemsSig\(p\.items\)/, 'Must not clear a newly changed cart');
assert.match(src, /sharePreviewUrl = URL\.createObjectURL\(p\.blob\)/);
assert.match(src, /URL\.revokeObjectURL\(sharePreviewUrl\)/);

// Exercise the actual renderer with a small fake Canvas implementation.
// Verify edit-sensitive caching and that no heavy clone/render queue occurs.
const from = src.indexOf('    const receiptCache = Object.create(null);');
const to = src.indexOf('    let pendingShare = null;', from);
assert(from >= 0 && to > from, 'Fast renderer must be present');
const renderer = src.slice(from, to);
let renders = 0;
let drawn = [];
let drawCalls = [];
const canvasContext = {
  measureText: text => ({ width: Array.from(String(text)).length * 8 }),
  scale() {}, fillRect() {}, beginPath() {}, setLineDash() {}, moveTo() {}, lineTo() {}, stroke() {},
  fillText: (text, x, y) => {
    drawn.push(String(text));
    drawCalls.push({ text: String(text), x, y, direction: canvasContext.direction });
  },
  direction: '', textAlign: '', font: '', lineWidth: 1, textBaseline: '', fillStyle: '', strokeStyle: ''
};
const fakeDocument = {
  createElement(type) {
    assert.equal(type, 'canvas');
    return {
      width: 0, height: 0,
      getContext: () => canvasContext,
      toBlob: (done, mime) => {
        assert.equal(mime, 'image/png');
        renders++;
        done({ type: mime, size: 2048, renderId: renders });
      }
    };
  }
};
const sandbox = { document: fakeDocument, shownName: i => i.displayName || i.name, console };
vm.createContext(sandbox);
vm.runInContext(renderer + '\nthis.api = {renderReceiptBlob, getCachedReceipt, itemsSig, wrapReceiptWords, normalizeReceiptDisplayName};', sandbox);
const api = sandbox.api;
const supplier = 'مورد التجربة';
const items = [{ supplierShareName: 'اسم الصنف المعدل للمورد', qty: 1.5, unit: 'كرتونة' }];
const first = await api.renderReceiptBlob(supplier, items);
assert.equal(renders, 1);
assert(drawn.join(' ').includes('اسم الصنف المعدل للمورد'), 'Must draw edited supplier name, word by word');
const second = await api.renderReceiptBlob(supplier, items);
assert.strictEqual(second, first, 'Identical receipt should use the cached Blob');
assert.equal(renders, 1);
const renamed = await api.renderReceiptBlob(supplier, [{ ...items[0], supplierShareName: 'اسم جديد للمورد' }]);
assert.equal(renders, 2, 'Edited supplier name must invalidate image');
assert.notStrictEqual(renamed, first);
await api.renderReceiptBlob(supplier, [{ ...items[0], qty: 2 }]);
assert.equal(renders, 3, 'Quantity change must invalidate image');
assert(api.wrapReceiptWords(canvasContext, 'اسم صنف طويل جداً على شاشة الهاتف يحتاج للف', 70).length > 1);
assert.equal(api.normalizeReceiptDisplayName('زيت بترومين50 20لتر'), 'زيت بترومين 50 20 لتر');
assert.equal(api.normalizeReceiptDisplayName('توتال 3000'), 'توتال 3000');
assert.equal(api.normalizeReceiptDisplayName('Mobil1 5W-30'), 'Mobil1 5W-30');
assert.equal(api.normalizeReceiptDisplayName('زيت\\u200f 20لتر'), 'زيت 20 لتر');

drawn = [];
drawCalls = [];
await api.renderReceiptBlob(supplier, [
  { supplierShareName: 'زيت بترومين50 20لتر', qty: 4, unit: 'كرتونة' }
]);
const itemWords = drawCalls.filter(d => d.y >= 117 && d.y < 180 && d.x >= 140);
assert.deepEqual(itemWords.map(d => d.text), ['زيت', 'بترومين', '50', '20', 'لتر'],
  'Mixed Arabic/digit product name must draw in readable logical token order');
assert(itemWords.filter(d => d.text === '20' || d.text === '50').every(d => d.direction === 'ltr'),
  'Numeric chunks must always be LTR');
assert(itemWords.filter(d => d.text === 'زيت' || d.text === 'لتر').every(d => d.direction === 'rtl'),
  'Arabic words must be drawn RTL');
const stamp = drawCalls.find(d => /^\\d{2}\\/\\d{2}\\/\\d{4}\\s+\\d{2}:\\d{2}$/.test(d.text));
assert(stamp && stamp.direction === 'ltr', 'Numeric date must be LTR and isolated from Arabic label');
assert(drawCalls.some(d => d.text === 'الكمية المطلوبة'), 'Keep original receipt header text');

console.log('Compare prices: syntax, fast receipt cache, edited name, mixed RTL numbers and timestamp checks passed.');