// فحوصات دفتر الموردين الموحد: نفس الأرقام في كل الصفحات ومطابقة لحساب الموردين (2101) في accounting.html
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../supplier-ledger.js');

const sup = (o = {}) => ({ id: 's1', name: 'مورد', openingBalance: 0, ...o });
const bal = (s, inv = [], vou = []) => L.buildLedger(s, inv, vou).balance;
const P = (o) => ({ id: 'i' + Math.random(), supplierId: 's1', type: 'شراء', total: 1000, date: '2026-11-01', ...o });

// فاتورة 1000 مدفوع منها 300 كاش + 200 محفظة => 500
assert.equal(bal(sup(), [P({ cashPaid: 300, walletPaid: 200 })]), 500);
// رصيد افتتاحي (موجب علينا، سالب لنا)
assert.equal(bal(sup({ openingBalance: 250 }), [P({ paid: 0 })]), 1250);
assert.equal(bal(sup({ openingBalance: -100 })), -100);
// total يسبق grossTotal، والسالب يحتفظ بإشارته (فاتورة كلها مرتجع)
assert.equal(bal(sup(), [P({ total: 400, grossTotal: 999 })]), 400);
assert.equal(bal(sup(), [P({ total: -150 })]), -150);
// مرتجع يقلل المديونية
assert.equal(bal(sup(), [P({}), P({ type: 'مرتجع شراء', total: 300 })]), 700);
// سند صرف يقلل، سند قبض يزيد
assert.equal(bal(sup(), [P({})], [{ id: 'v1', type: 'صرف', partyId: 's1', amount: 400 }]), 600);
assert.equal(bal(sup(), [P({})], [{ id: 'v1', type: 'قبض', partyId: 's1', amount: 100 }]), 1100);
// السند المرآة للفاتورة لا يُحسب مرتين
assert.equal(bal(sup(), [P({ cashPaid: 300, id: 'inv9' })], [{ id: 'm', type: 'صرف', partyId: 's1', supplierId: 's1', invoiceId: 'inv9', amount: 300 }]), 700);
// سندات المصروفات لا تؤثر على المورد
assert.equal(bal(sup(), [], [{ id: 'e', type: 'صرف', partyId: 's1', amount: 50, isExpense: true }]), 0);
// المحذوف يُتجاهل
assert.equal(bal(sup(), [P({ isDeleted: true })], [{ id: 'd', type: 'صرف', partyId: 's1', amount: 50, deleted: true }]), 0);
// الربط بالمعرّف فقط وليس بالاسم
assert.equal(bal(sup(), [P({ supplierId: 's2', supplierName: 'مورد' })]), 0);

// أرصدة قبل/بعد كل حركة متصلة ببعض ومرتبة زمنيًا
const led = L.buildLedger(sup(), [P({ date: '2026-11-01', total: 1000, paid: 200 }), P({ date: '2026-11-03', total: 500, paid: 0 })], []);
assert.equal(led.events.length, 2);
assert.equal(led.events[0].before, 0); assert.equal(led.events[0].after, 800);
assert.equal(led.events[1].before, 800); assert.equal(led.events[1].after, 1300);
// استبعاد فاتورة عند التعديل
assert.equal(L.balanceExcluding(sup(), [P({ id: 'x', total: 100 }), P({ id: 'y', total: 50 })], [], 'x'), 50);

// تطابق مع قيود 2101 في accounting.html
const html = fs.readFileSync(new URL('../accounting.html', import.meta.url), 'utf8');
const code = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const a = code.indexOf('const CH='), b = code.indexOf('function recon(');
const lib = new Function("const document={querySelector:()=>null};\n" + code.slice(a, b) + '\nreturn { build, L, state };')();
const invs = [
  { id: 'a1', supplierId: 's1', type: 'شراء', total: 1000, cashPaid: 300, walletPaid: 100, date: '2026-11-01' },
  { id: 'a2', supplierId: 's1', type: 'مرتجع شراء', total: 200, date: '2026-11-02' }
];
const vous = [{ id: 'q1', type: 'صرف', partyId: 's1', amount: 150, date: '2026-11-03' }];
const { out } = lib.build({
  invoices: [], transactions: vous, supplier_transactions: invs, expenses: [], cash_logs: [],
  inventory: [], customers: [], suppliers: [{ id: 's1' }]
}, { cus: new Set(), sup: new Set(['s1']), after: () => true });
const acc2101 = out.reduce((t, e) => t + e.lines.filter(l => l.a === '2101').reduce((x, l) => x + l.c - l.d, 0), 0);
assert.equal(Math.round(bal(sup(), invs, vous) * 100), Math.round(acc2101 * 100), 'ledger must equal accounting 2101');

console.log('supplier-ledger checks passed');
