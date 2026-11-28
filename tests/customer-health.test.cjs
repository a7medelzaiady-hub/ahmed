// Run: node --test tests/customer-health.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'customer-statement.html'), 'utf8');
const match = html.match(/function renderCustomerHealth\(invoices, balance\) \{[\s\S]*?\n    \}/);
assert.ok(match, 'Customer health renderer exists');
const now = Date.parse('2026-11-28T12:00:00Z');
const elements = new Map();
const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', style: {} }); return elements.get(id); } };
const context = vm.createContext({ document, Date: class extends Date { static now() { return now; } }, Number, Math, Set });
vm.runInContext(match[0] + '\nthis.render = renderCustomerHealth;', context);
const invoice = (daysAgo, total = 100) => ({ ts: now - daysAgo * 86400000, tot: total, t: 'فاتورة مبيعات' });
function check(invoices, balance = 0) {
  context.render(invoices, balance);
  return { badge: document.getElementById('healthBadge').textContent, action: document.getElementById('healthAction').textContent, stats: document.getElementById('healthStats').innerHTML };
}
test('no history is insufficient data', () => assert.match(check([]).badge, /بيانات غير كافية/));
test('one invoice is new', () => assert.match(check([invoice(2)]).badge, /عميل جديد/));
test('two distinct purchase days are insufficient for churn classification', () => assert.match(check([invoice(40), invoice(30)]).badge, /بيانات غير كافية/));
test('late customer with established cadence is at risk', () => assert.match(check([invoice(60), invoice(55), invoice(50)]).badge, /متوقف/));
test('returns or zero invoices do not count as purchases', () => assert.match(check([invoice(1, -50), invoice(3, 0)]).badge, /بيانات غير كافية/));
test('debt appears separately in suggested action', () => assert.match(check([invoice(2)], 150).action, /رصيد مستحق/));
test('no new Firestore listeners added by health feature', () => assert.doesNotMatch(match[0], /onSnapshot|getDocs|getDoc/));
