// Run: node scripts/check-edited-product-share.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../compare-prices.html', import.meta.url), 'utf8');
function extract(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert(a >= 0 && b > a, 'Missing source boundary: ' + start);
  return html.slice(a, b);
}
const ctx = {};
vm.runInNewContext(
  extract('function normalizeItemNames(item)', 'function saveDraftToStorage()') +
  '\nthis.makeShareItem = itemForSupplierShare; this.shownName = shownName;', ctx
);

const editable = { name: 'توتال', productName: 'توتال', originalName: 'توتال',
  displayName: 'توتال 3000', qty: 2, unit: 'كرتونة', price: 1950 };
const shareItem = ctx.makeShareItem(editable);
assert.equal(shareItem.supplierShareName, 'توتال 3000');
assert.equal(shareItem.name, 'توتال', 'catalog name must not be changed');
assert.equal(shareItem.originalName, 'توتال', 'link to inventory must be preserved');
assert.equal(editable.name, 'توتال', 'sharing must not mutate the cart');
assert.equal(editable.displayName, 'توتال 3000');
assert.equal(ctx.makeShareItem({ name: 'احمر 1 لتر', displayName: '' }).supplierShareName, 'احمر 1 لتر');
assert.equal(ctx.makeShareItem({ name: 'قديم', originalName: 'توتال', displayName: 'توتال خاص' }).supplierShareName, 'توتال خاص');
assert.equal(ctx.makeShareItem({ name: 'توتال', displayName: 'توتال' }).supplierShareName, 'توتال');

vm.runInNewContext(
  extract('function buildOrderText(p)', 'function normalizePhone(ph)') +
  '\nthis.buildOrderText = buildOrderText;', ctx
);
const outgoing = ctx.buildOrderText({ supplierName: 'عالميه', items: [shareItem] });
assert(outgoing.includes('توتال 3000: 2 كرتونة'), 'WhatsApp text uses the edited name');
assert(!outgoing.includes('• توتال: 2'), 'WhatsApp text must not revert to catalog name');

vm.runInNewContext(
  extract('function escapeShareText(value)', 'function renderReceiptBlob(supplierName, items)') +
  '\nthis.escapeShareText = escapeShareText;', ctx
);
assert.equal(ctx.escapeShareText('توتال <3000>'), 'توتال &lt;3000&gt;');
assert(html.includes('escapeShareText(item.supplierShareName || shownName(item))'),
  'image generator must use the edited supplier-facing name');
assert(html.includes('const items = (sourceItems || []).map(itemForSupplierShare)'),
  'snapshot the edited names at share time');
assert(html.includes('const blob = await renderReceiptBlob(supplierName, items)'),
  'fresh image must be created after user clicks share');
assert(!extract('window.shareReceiptImage = async', 'window.openOrdersHistoryModal = async')
  .includes('getCachedReceipt(supplierName, items)'),
  'do not send a pre-rendered image with an old name');
assert(html.includes('delete receiptCache[supplierName]'), 'renaming invalidates cached image');
assert(html.includes("displayName: i.displayName || ''"), 'saved history preserves edited supplier name');
assert(html.includes('shareReceiptImage(order.supplierName, order.items,'),
  'history share goes through the same edited-name path');
console.log('Edited-name share regression tests passed.');
