// فحوصات صفحة السندات اليدوية (vouchers.html) وصفحة جرد العربية (quotation-history.html)
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

// ---------------- quotation-history.html (صفحة جرد العربية) ----------------
const qHtml = read('quotation-history.html');
const q = moduleOf(qHtml);
syntax(q);
// مبيعات الجرد = مبيعات العربية فقط، ومبيعات المخزن مستبعدة
assert.ok(/where\("source", "==", "van_sales"\)/.test(q), 'only van invoices are listened to');
assert.ok(/inv\.source !== 'van_sales'/.test(q), 'warehouse (main_store) invoices are excluded from today sales');
// الرصيد السابق من آخر جرد محفوظ (مستند واحد) وليس امبارح فقط
assert.ok(/where\('date', '<', d\), orderBy\('date', 'desc'\), limit\(1\)/.test(q), 'previous balance comes from the last saved count (single doc)');
assert.ok(/getDoc\(doc\(db, 'daily_loads', getPreviousDateStr\(d\)\)\)/.test(q), 'falls back to the previous calendar day');
assert.ok(/currentListenDate !== d\) return;/.test(q), 'stale previous-balance result is ignored after changing the date');
// التحميل: كاش فوري + تحديث ثقيل بالخلفية بس لو الكاش قديم
assert.ok(/hydrateInventoryFromCache\(\)/.test(q) && /INV_CACHE_MAX_AGE_MS/.test(q), 'cache-first inventory');
assert.ok(/if \(age > INV_CACHE_MAX_AGE_MS\) window\.fetchInventoryFresh\(\);/.test(q), 'background refresh only when the cache is old');
assert.ok(/saveInventoryCache\(\);/.test(q), 'fresh balances are cached');
assert.ok(!/ts\.seconds\*1000\)\.toISOString/.test(q), 'invoice timestamp fallback uses the local day');

console.log('Vouchers + car-truck audit page: syntax, single data load, local dates, van-only sales, last-count previous balance, cache-first loading, batching and balance-formula checks passed.');
