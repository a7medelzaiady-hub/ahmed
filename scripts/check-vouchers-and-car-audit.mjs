// فحوصات صفحة السندات اليدوية (vouchers.html) وصفحة جرد العربية (car-audit.html)
process.env.TZ = 'Africa/Cairo';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const moduleOf = (html) => {
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(m, 'module script not found');
  return m[1];
};
const syntax = (code) => new Function('return async function(){' + code.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, '').replace(/^\s*import .*$/gm, '') + '}');
const grabFn = (code, name) => {
  const r = code.match(new RegExp('function ' + name + '\\((?:[^()]|\\([^()]*\\))*\\) \\{[\\s\\S]*?\\n    \\}'));
  assert.ok(r, 'missing ' + name);
  return r[0];
};

// ---------------- vouchers.html ----------------
const vHtml = read('vouchers.html');
const v = moduleOf(vHtml);
syntax(v);
assert.ok(!/toISOString\(\)\.split|toISOString\(\)\.slice/.test(v), 'vouchers: UTC date helper must not come back');
assert.ok(/function localDateStr\(/.test(v));
// تحميل البيانات مرة واحدة فقط (init) وليس مرتين
assert.equal((v.match(/await fetchPartiesData\(\)/g) || []).length, 4, 'fetchPartiesData is called by init + submit + delete + delete-all only');
const dcl = v.match(/addEventListener\("DOMContentLoaded"[\s\S]*?\n    \}\);/)[0];
assert.ok(!/fetchPartiesData|loadVouchers/.test(dcl), 'DOMContentLoaded must not reload the data again');
assert.ok(/if \(d\.isDeleted\) return;[^\n]*\n\s*\n?\s*let actualPartyId/.test(v), 'soft-deleted vouchers are skipped');
assert.ok(/writeBatch\(db\)/.test(v) && !/allVouchers\.map\(v => deleteDoc/.test(v), 'delete-all uses batches');
assert.ok(/submitBtn\.disabled = true/.test(v) && /finally \{\s*submitBtn\.disabled = false/.test(v), 'double submit is guarded');
// معادلة رصيد العميل مطابقة لصفحة تفاصيل العميل
const cb = v.match(/async function calculateCustomerBalanceAt[\s\S]*?\n    \}\n/)[0];
assert.ok(/d\.isDeleted/.test(cb) && /d\.invoiceId/.test(cb) && /فاتورة/.test(cb), 'customer balance skips deleted and invoice-linked payments');
assert.ok(/total\) \|\| 0\) - paid/.test(cb), 'invoice debt is total - paid');

// pad2 helper لازم يتعرّف قبلها
const vFns = new Function("const pad2 = (n) => String(n).padStart(2, '0');\n" + grabFn(v, 'localDateStr') + "\nreturn { localDateStr };")();
assert.equal(vFns.localDateStr(new Date('2026-11-28T22:30:00Z')), '2026-11-29', 'Cairo midnight rolls to the next local day');
assert.equal(vFns.localDateStr(new Date('2026-11-28T10:00:00Z')), '2026-11-28');

// ---------------- car-audit.html ----------------
const cHtml = read('car-audit.html');
const c = moduleOf(cHtml);
syntax(c);
assert.ok(!/toISOString\(\)\.split|toISOString\(\)\.slice/.test(c), 'car-audit: UTC date helper must not come back');
assert.ok(/const todayDocId = localDateStr\(\)/.test(c));

// الكروت تظهر قبل الحساب الثقيل، والفواتير تتقرأ في دالة الخلفية فقط
const invReads = c.match(/getDocs\(collection\(db, "invoices"\)\)/g) || [];
assert.equal(invReads.length, 1, 'invoices are read once');
assert.ok(c.indexOf('async function loadWarehouseBalances') < c.indexOf('getDocs(collection(db, "invoices"))'));
assert.ok(/await loadInventoryBase\(\);[\s\S]*await loadWarehouseBalances\(\)/.test(c), 'base list renders before the heavy balance pass');
assert.ok(/readCache\(\)\) renderAuditCards\(\)/.test(c), 'instant render from the cached copy');

// آخر رصيد جرد: مستند واحد قبل اليوم
assert.ok(/where\("date", "<", todayDocId\), orderBy\("date", "desc"\), limit\(1\)/.test(c), 'previous count is a single-document query');
// الكتابة صنف واحد بدل مسح الخريطة كلها
assert.ok(/items: \{ \[id\]: st \}/.test(c), 'single item save does not rewrite the whole map');
// مبيعات اليوم لا تساوي مبيعات كل الفترات
assert.ok(/isToday/.test(c) && /todaySalesMap\.get\(item\.id\)/.test(c), 'today sales are date-filtered');
assert.ok(!/oninput="updateLoadState/.test(c), 'no inline handlers with ids');

const cFns = new Function(
  "const pad2 = (n) => String(n).padStart(2, '0');\n" +
  grabFn(c, 'localDateStr') + '\n' + grabFn(c, 'recordDateStr') + '\n' +
  "const hasVal = (v) => v !== '' && v != null && !isNaN(Number(v));\n" +
  'return { recordDateStr, localDateStr, hasVal };'
)();
assert.equal(cFns.recordDateStr({ date: '2026-11-28' }), '2026-11-28');
assert.equal(cFns.recordDateStr({ date: '28/11/2026' }), '2026-11-28');
assert.equal(cFns.recordDateStr({ timestamp: { toDate: () => new Date('2026-11-28T22:30:00Z') } }), '2026-11-29');
assert.equal(cFns.recordDateStr({}), '');
assert.equal(cFns.hasVal(''), false);
assert.equal(cFns.hasVal('0'), true);

console.log('Vouchers + car audit: syntax, single data load, local dates, today-only sales, previous-count prefill, batching and balance-formula checks passed.');
