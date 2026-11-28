// فحوصات النظام المحاسبي: القيود لازم تتزن، وسندات (نقدي + محفظة) تتسجل على حساباتها
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../accounting.html', import.meta.url), 'utf8');
const code = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
new Function('return async function(){' + code.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, '') + '}');

const a = code.indexOf('const CH=');
const b = code.indexOf('function recon(');
assert.ok(a > 0 && b > a);
const lib = new Function(
  "const document={querySelector:()=>null};\n" + code.slice(a, b) + '\nreturn { build, L, state };'
)();

const S = (over = {}) => ({
  invoices: [], transactions: [], supplier_transactions: [], expenses: [], cash_logs: [],
  inventory: [{ id: 'p1', buy: 120, unitFactor: 12 }], customers: [{ id: 'c1' }], suppliers: [{ id: 's1' }], ...over
});
const X = { cus: new Set(['c1']), sup: new Set(['s1']), after: () => true };
const balanced = (entries) => entries.forEach(e => {
  const d = e.lines.reduce((t, l) => t + l.d, 0), c = e.lines.reduce((t, l) => t + l.c, 0);
  assert.equal(Math.round((d - c) * 100), 0, e.id + ' must balance');
});
const acc = (e, code) => e.lines.filter(l => l.a === code).reduce((t, l) => t + l.d - l.c, 0);

// سند قبض من عميل: 100 كاش + 50 محفظة
let { out } = lib.build(S({ transactions: [{ id: 't1', type: 'قبض', partyId: 'c1', amount: 150, cashPaid: 100, walletPaid: 50, date: '2026-11-28' }] }), X);
assert.equal(out.length, 1); balanced(out);
assert.equal(acc(out[0], '1101'), 100); assert.equal(acc(out[0], '1102'), 50); assert.equal(acc(out[0], '1103'), -150);

// سند صرف لعميل: الكاش والمحفظة بيخرجوا
({ out } = lib.build(S({ transactions: [{ id: 't2', type: 'صرف', partyId: 'c1', amount: 90, cashPaid: 40, walletPaid: 50, date: '2026-11-28' }] }), X));
balanced(out); assert.equal(acc(out[0], '1101'), -40); assert.equal(acc(out[0], '1102'), -50); assert.equal(acc(out[0], '1103'), 90);

// سند قديم من غير تقسيم: زي ما كان (حسب طريقة الدفع)
({ out } = lib.build(S({ transactions: [
  { id: 't3', type: 'قبض', partyId: 'c1', amount: 70, method: 'محفظة', date: '2026-11-28' },
  { id: 't4', type: 'قبض', partyId: 'c1', amount: 30, date: '2026-11-28' },
  { id: 't5', type: 'قبض', partyId: 'c1', amount: 10, cashPaid: 3, walletPaid: 3, date: '2026-11-28' } // مجموع الأجزاء مش بيساوي المبلغ: ما نقسمش
] }), X));
balanced(out);
assert.equal(acc(out[0], '1102'), 70); assert.equal(acc(out[1], '1101'), 30); assert.equal(acc(out[2], '1101'), 10);

// باقي أنواع القيود لازم تتزن
({ out } = lib.build(S({
  invoices: [{ id: 'i1', total: 500, cashAmount: 200, walletAmount: 100, customerName: 'x', date: '2026-11-28', items: [{ stockId: 'p1', qty: 12, unit: 'جركن' }] },
             { id: 'i2', type: 'مرتجع', total: 50, date: '2026-11-28', items: [{ stockId: 'p1', qty: 2 }] }],
  supplier_transactions: [{ id: 'u1', total: 1000, cashPaid: 300, walletPaid: 200, supplierId: 's1', date: '2026-11-28' }],
  expenses: [{ id: 'e1', amount: 25, type: 'بنزين', paymentMethod: 'نقدي', date: '2026-11-28' }],
  cash_logs: [{ id: 'l1', type: 'in', amount: 15, date: '2026-11-28' }]
}), X));
assert.equal(out.length, 5); balanced(out);

console.log('Accounting: every generated journal entry balances and cash/wallet vouchers post to the right accounts.');
