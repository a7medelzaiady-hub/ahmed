import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calculateStockBalances, normalizeStockName } from '../stock-balance.mjs';

const stock = [{ id: 'oil5', name: 'سوبر ديزل 5', unitFactor: 6, unit: 'جركن', openingTotalPcs: 6 }];
const sale = { items: [{ stockId: 'oil5', qty: 6, unit: 'جركن' }] };
const returned = { type: 'return', items: [{ productId: 'oil5', qty: 6, unit: 'جركن' }] };
const inputs = {
  inventoryItems: stock,
  salesInvoices: [sale, returned],
  supplierTransactions: [],
  openingTransactions: []
};
function balance(changes = {}) {
  const results = calculateStockBalances({ ...inputs, ...changes });
  assert.equal(results.length, 1);
  return results[0];
}

// Reproduces the reported mismatch: a whole-return invoice referenced the
// productId rather than stockId, which the old makhzan.html code ignored.
assert.equal(balance().totalPcs, 6, 'سوبر ديزل 5 should be 1 carton (6 pieces)');
assert.equal(balance({ salesInvoices: [sale] }).totalPcs, 0, 'Without the return, stock is zero');
assert.equal(balance({ salesInvoices: [sale, { ...returned, status: 'cancelled' }] }).totalPcs, 0);
assert.equal(balance({ salesInvoices: [sale, { ...returned, isDeleted: true }] }).totalPcs, 0);
assert.equal(balance({
  salesInvoices: [sale, { items: [{ name: 'سُوبر ديزل 5', qty: 6, unit: 'جركن', isReturn: true }] }]
}).totalPcs, 6, 'Arabic name normalization must find the same product');
assert.equal(normalizeStockName('إسبير') , normalizeStockName('اسبير'));

const purchase = { items: [{ productId: 'oil5', qty: 1, unit: 'كرتونة' }] };
const purchaseReturn = { items: [{ stockId: 'oil5', returnQty: 1, qty: 1, unit: 'كرتونة' }] };
assert.equal(balance({ supplierTransactions: [purchase] }).totalPcs, 12);
assert.equal(balance({ supplierTransactions: [purchase, purchaseReturn] }).totalPcs, 6);
assert.equal(balance({ supplierTransactions: [{ ...purchase, isDeleted: true }] }).totalPcs, 6);
assert.equal(balance({
  salesInvoices: [{ items: [{ stockId: 'oil5', qty: 1, unit: 'كرتونة', unitFactor: 12 }] }]
}).totalPcs, -6, 'Historical carton conversion must use line item factor');
assert.equal(balance({
  inventoryItems: [{ id: 'oil5', name: 'سوبر ديزل 5', pcsPerCarton: 6 }],
  salesInvoices: [],
  openingTransactions: [{ productId: 'oil5', quantityPcs: 13 }]
}).totalPcs, 13, 'Fallback opening balance movements must be recognized');

for (const file of ['makhzan.html', 'quotation-history.html']) {
  const html = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  assert.match(html, /import \{ calculateStockBalances \} from ["']\.\/stock-balance\.mjs["']/);
  assert.match(html, /calculateStockBalances\(\{/);
  assert.match(html, /inventoryItems:/);
  assert.match(html, /supplierTransactions:/);
  assert.match(html, /openingTransactions:/);
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert(script, 'Missing main module in ' + file);
  const directory = mkdtempSync(join(tmpdir(), 'stock-page-'));
  try {
    const scriptPath = join(directory, 'page.mjs');
    writeFileSync(scriptPath, script[1]);
    const check = spawnSync(process.execPath, ['--check', scriptPath], { encoding: 'utf8' });
    assert.equal(check.status, 0, file + ': ' + (check.stderr || 'JavaScript syntax error'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const warehouse = readFileSync(new URL('../makhzan.html', import.meta.url), 'utf8');
assert.match(warehouse, /id="stockDataState"/);
assert.match(warehouse, /الرصيد محدّث/);
assert.match(warehouse, /قد تكون البيانات قديمة/);

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const cacheVersion = Number(sw.match(/CACHE_NAME\s*=\s*"elzaiady-cache-v(\d+)"/)?.[1]);
assert(Number.isSafeInteger(cacheVersion) && cacheVersion >= 19,
  'Stock-balance module needs to remain precached in PWA release v19 or newer');
assert.match(sw, /"\.\/stock-balance\.mjs"/);
const quote = readFileSync(new URL('../quotation-history.html', import.meta.url), 'utf8');
assert.match(quote, /📦 الرصيد السابق/);
assert.match(quote, /const totalLoadedPcs = totalPrevPcs \+ totalNewPcs/);
console.log('Stock balances: warehouse/truck match, return, deleted, cartons, archive and syntax checks passed.');
