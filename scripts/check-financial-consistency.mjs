// Regression checks for high-risk financial workflows. Run: node scripts/check-financial-consistency.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const salary = read('salaries-advances.html');
const sales = read('sales-invoice.html');
const history = read('sales-history.html');
const customers = read('customer-list.html');
const stock = read('inventory.html');
const stockList = read('inventory-list.html');
const valuation = read('inventory-valuation.html');
const purchase = read('new-purchase-invoice.html');
const legacy = read('sales_transactions.html');

const first = salary.indexOf('function localDateKey(');
const last = salary.indexOf('function advancesOf(driverId)');
assert(first > 0 && last > first, 'salary date helpers exist');
const ctx = {};
vm.runInNewContext(salary.slice(first, last) +
  '\nthis.shiftMonthKey=shiftMonthKey; this.localDateKey=localDateKey; this.isOverLimitMarker=isOverLimitMarker;', ctx);
for (const [month, offset, expected] of [
  ['2026-11', -1, '2026-10'], ['2026-11', 1, '2026-12'],
  ['2026-01', -1, '2025-12'], ['2026-12', 1, '2027-01'],
  ['2024-03', -1, '2024-02'], ['2024-02', 1, '2024-03']
]) assert.equal(ctx.shiftMonthKey(month, offset), expected);
assert.equal(ctx.localDateKey(new Date(2026, 10, 25)), '2026-11-25');
assert.equal(ctx.isOverLimitMarker({ isDeficit: true, note: 'عجز عن تجاوز الحد المسموح بالسلفة' }), true);
assert.equal(ctx.isOverLimitMarker({ isDeficit: true, note: 'عجز يومي' }), false);
assert(salary.includes("if (type === 'deficit') return a.isDeficit && !isOverLimitMarker(a);"));
assert(!salary.includes('amount: excess, date, note:'), 'do not add a second deduction for an exceptional advance');
assert(salary.includes('shiftMonthKey(currentMonth, -1)'));
assert(salary.includes('shiftMonthKey(currentMonth, 1)'));

const save = sales.slice(sales.indexOf('window.saveInvoice = async'), sales.indexOf('function prepareThermalReceipt'));
assert(save.includes('if (!navigator.onLine)'));
assert(save.includes('await batch.commit()'));
assert(!save.includes('commitPromise'));
assert(save.indexOf('await batch.commit()') < save.indexOf('clearDraftSilently()'),
  'do not discard drafts until Firestore confirms the save');
assert(save.includes('createdInvoiceId') && save.includes('if (createdInvoiceId) editId = createdInvoiceId'));
assert(sales.includes("if (invoice.isDeleted || invoice.status === 'deleted'"));
assert(sales.includes("if (purchase.isDeleted || purchase.status === 'deleted'"));

assert(customers.includes("updateDoc(doc(db, 'customers', id), { isDeleted: true"));
assert(!customers.includes('deleteDoc('), 'do not permanently delete customer records');
assert(customers.includes('Math.abs(Number(customer.realBalance) || 0) >= 0.01'));

assert(stock.includes('loadSequence !== inventoryLoadSequence'));
assert(stock.includes("if (invData.isDeleted) return"));
assert(stockList.includes("getDocs(collection(db, 'invoices'))"));
assert(stockList.includes("getDocs(collection(db, 'supplier_transactions'))"));
assert(stockList.includes('if (invoice.isDeleted || invoice.status'));
assert(stockList.includes('if (purchase.isDeleted || purchase.status'));
assert(valuation.includes('if (purchase.isDeleted || purchase.status'));

assert(purchase.includes('const previousPayments = await getDocs(query(collection(db, "transactions"), where("invoiceId", "==", editId)))'));
assert(purchase.includes('batch.delete(payment.ref)'));
assert(history.includes('isArchived: true, archivedAt:'));
assert(!history.includes('username.includes("أحمد")'));
assert(legacy.includes("window.location.replace('sales-history.html')"));
assert(!legacy.includes('deleteDoc('));

console.log('Financial consistency regression checks: PASS');
