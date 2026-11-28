// رصيد المخزن لازم يطلع من حساب واحد (stock-balance.mjs) في صفحات المخزن والأصناف وجرد السيارة
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { calculateStockBalances } from '../stock-balance.mjs';

for (const f of ['makhzan.html', 'inventory.html', 'car-audit.html']) {
  const s = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  assert.ok(s.includes('from "./stock-balance.mjs"'), f + ' لازم يستورد stock-balance.mjs');
  assert.ok(s.includes('calculateStockBalances('), f + ' لازم يستخدم calculateStockBalances');
  assert.ok(!/purchasesMap(Global)?\.set\(/.test(s), f + ' فيه نسخة مستقلة من حساب المشتريات');
  assert.ok(!/salesMap(Global)?\.set\(id,/.test(s), f + ' فيه نسخة مستقلة من حساب المبيعات');
}

const inv = [{ id: 'f1', name: 'فورما صغير', unitFactor: 24 }];
const it = (o) => ({ name: 'فورما صغير', stockId: 'f1', ...o });
const [r] = calculateStockBalances({
  inventoryItems: inv,
  salesInvoices: [
    { items: [it({ qty: 2, unit: 'كرتونة', isCarton: true })] },
    { status: 'deleted', items: [it({ qty: 1, unit: 'كرتونة', isCarton: true })] },   // محذوفة: تتجاهل
    { type: 'return', items: [it({ qty: 1, unit: 'كرتونة', isCarton: true })] }       // مرتجع بيع: يرجّع للمخزن
  ],
  supplierTransactions: [
    { items: [it({ qty: 5, unitName: 'كرتونة' })] },
    { items: [it({ returnQty: 1, unitName: 'كرتونة' })] },
    { items: [it({ qty: 10 })] }                                                       // من غير وحدة: قطع
  ],
  openingTransactions: []
});
assert.equal(r.totalPcs, 82);
console.log('stock unified checks passed');
