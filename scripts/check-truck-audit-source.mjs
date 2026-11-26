import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const fromRepo = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const audit = fromRepo('quotation-history.html');
const history = fromRepo('item-car-report.html');

function mainModule(html, name) {
    const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
    assert(m, 'Missing module in ' + name);
    const dir = mkdtempSync(join(tmpdir(), 'truck-audit-'));
    try {
        const filename = join(dir, 'module.mjs');
        writeFileSync(filename, m[1]);
        const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
        assert.equal(result.status, 0, name + ': ' + result.stderr);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
    return m[1];
}
const auditScript = mainModule(audit, 'quotation-history.html');
const reportScript = mainModule(history, 'item-car-report.html');

// The sales form records the explicit source. Missing source is NOT accepted
// as a van sale (sales-history already defaults legacy invoices to main_store).
const invoiceForm = fromRepo('sales-invoice.html');
assert.match(invoiceForm, /<option value="van_sales" selected>/);
assert.match(invoiceForm, /<option value="main_store">/);
assert.match(invoiceForm, /source: invoiceSource/);
assert.match(auditScript, /query\(collection\(db, "invoices"\), where\("source", "==", "van_sales"\)\)/,
    'Truck audit must avoid reading warehouse invoices entirely');
assert.match(auditScript, /inv\.source !== 'van_sales'/,
    'Truck audit must keep a defensive source check');
assert.match(audit, /جرد العربية يعتمد على مبيعات العربية فقط/);

// Execute the real recomputeSales function against van + warehouse invoices.
function between(s, before, after) {
    const a = s.indexOf(before), b = s.indexOf(after, a);
    assert(a >= 0 && b > a, 'Missing function bounds: ' + before);
    return s.slice(a, b);
}
const recompute = between(auditScript, 'function recomputeSales() {', 'function listenToLiveInvoices() {');
const inv = (source, qty, extra = {}) => ({
    source, items: [{ stockId: 'oil', qty, unit: 'جركن' }], ...extra
});
const sandbox = {
    dayInvoices: new Map([
        ['van', inv('van_sales', 3)],
        ['store', inv('main_store', 100)],
        ['legacy', inv(undefined, 50)],
        ['vanReturn', inv('van_sales', 1, { type: 'return' })],
        ['storeReturn', inv('main_store', 70, { type: 'return' })],
        ['canceled', inv('van_sales', 25, { status: 'cancelled' })],
        ['deleted', inv('van_sales', 45, { isDeleted: true })]
    ]),
    memorySalesCache: {},
    factorsMap: { oil: 6 },
    getProductIdForItem: item => item.stockId,
    isCartonUnit: () => false,
    isSalesReady: false,
    buildCalculatedRows: () => {}
};
vm.createContext(sandbox);
vm.runInContext(recompute + '\nrecomputeSales();', sandbox);
assert.equal(sandbox.memorySalesCache.oil, 2,
    'Van 3 sold - van return 1 = 2. Store sales/returns and legacy must not affect the truck');
assert.equal(sandbox.isSalesReady, true);

// Verify the separate item/vehicle report uses the same rule for truck days,
// while preserving *all* sources for the independent warehouse stock balance.
assert.match(reportScript, /source: inv\.source \|\| 'main_store'/);
assert.match(reportScript, /\(salesIdx\[item\.id\] \|\| \[\]\)\.filter\(s => s\.source === 'van_sales'\)/);
assert.match(reportScript, /const allNetSales = \(salesIdx\[item\.id\] \|\| \[\]\)\.filter\(x => inRange\(x\.date\)\)/);
const buildDays = between(reportScript, 'function buildDays(item) {', 'const TX_META =');
const ctx = {
    salesIdx: { oil: [
        { date: '2026-11-26', pcs: 3, source: 'van_sales', isReturn: false, party: 'Van sale', raw: 3, carton: false },
        { date: '2026-11-26', pcs: 100, source: 'main_store', isReturn: false, party: 'Warehouse sale', raw: 100, carton: false },
        { date: '2026-11-26', pcs: 1, source: 'van_sales', isReturn: true, party: 'Van return', raw: 1, carton: false },
        { date: '2026-11-26', pcs: 99, source: 'main_store', isReturn: true, party: 'Store return', raw: 99, carton: false },
        { date: '2026-11-26', pcs: 50, source: undefined, isReturn: false, party: 'Legacy', raw: 50, carton: false }
    ] },
    purchIdx: { oil: [] },
    loadsByDate: { '2026-11-26': true },
    getLoad: () => ({ prev: 2, loaded: 10, manual: 2 })
};
vm.createContext(ctx);
const days = vm.runInContext(buildDays + '\nbuildDays({id:"oil"});', ctx);
assert.equal(days.length, 1);
assert.equal(days[0].sold, 3, 'Warehouse sales must not be deducted from truck days');
assert.equal(days[0].sRet, 1, 'Warehouse returns must not increase truck remaining');
assert.equal(days[0].remaining, 2 + 10 - 3 + 1 - 2, 'Truck calculation must remain unchanged');
assert.equal(days[0].tx.length, 2, 'Truck movement details must only show van sale and return');

console.log('Truck audit: van sales, returns, legacy invoices, warehouse isolation and JS syntax checks passed.');
