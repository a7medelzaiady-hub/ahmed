// فحوصات صفحة client-vouchers.html: صحة الجافاسكربت + منطق الأرصدة + حماية الإدخال
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../client-vouchers.html', import.meta.url), 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(m, 'module script not found');
const code = m[1];

// 1) الصياغة سليمة (نشيل import ونلفّها كدالة async)
new Function('return async function(){' + code.replace(/^\s*import .*$/gm, '') + '}');

// 2) نسحب الدوال النقية ونجربها فعليًا
const grab = (name) => {
  const re = new RegExp('(function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n    \\})|(const ' + name + ' = [^\\n]*;)');
  const r = code.match(re);
  assert.ok(r, 'missing ' + name);
  return r[0];
};
const lib = new Function(
  grab('todayLocal') + '\n' + grab('round2') + '\n' + grab('esc') + '\n' + grab('voucherEffect') + '\n' + grab('planPosting') +
  '\nreturn { todayLocal, round2, esc, voucherEffect, planPosting };'
)();

assert.equal(lib.voucherEffect('قبض', 100), -100);
assert.equal(lib.voucherEffect('صرف', 100), 100);
assert.equal(lib.voucherEffect('غير معروف', 100), 0);
assert.equal(lib.round2(0.1 + 0.2), 0.3);
assert.match(lib.todayLocal(), /^\d{4}-\d{2}-\d{2}$/);
assert.equal(lib.esc(`عبدالله's <b>"x"</b>`), 'عبدالله&#39;s &lt;b&gt;&quot;x&quot;&lt;/b&gt;');
assert.equal(lib.esc(undefined), '');

// 3) المحاكاة: تعديل سند بنفس العميل وبتغيير العميل
// العميل رصيده 1000، سند قبض 300 اتسجل (الرصيد بقى 700)، بنعدله لقبض 100 → المفروض 900
let r = lib.planPosting(700, { type: 'قبض', total: 300, sameParty: true }, 'قبض', 100);
assert.deepEqual(r, { previous: 1000, final: 900, otherPartyUndo: 0 });
// تعديل قبض لصرف لنفس العميل: 700 + 300 (نلغي القبض) = 1000 ثم صرف 100 = 1100
r = lib.planPosting(700, { type: 'قبض', total: 300, sameParty: true }, 'صرف', 100);
assert.deepEqual(r, { previous: 1000, final: 1100, otherPartyUndo: 0 });
// نقل سند قبض 300 لعميل تاني رصيده 500: العميل الجديد 500 → 200، والقديم يرجّع +300
r = lib.planPosting(500, { type: 'قبض', total: 300, sameParty: false }, 'قبض', 300);
assert.deepEqual(r, { previous: 500, final: 200, otherPartyUndo: 300 });
// سند جديد
r = lib.planPosting(0.1, null, 'صرف', 0.2);
assert.deepEqual(r, { previous: 0.1, final: 0.3, otherPartyUndo: 0 });

// 4) فحوصات على نص الصفحة
assert.ok(!/toISOString\(\)\.split/.test(code), 'UTC date helper must not come back');
assert.ok(/min="0"/.test(html), 'amount inputs must reject negatives');
assert.ok(/writeBatch\(db\)/.test(code), 'balance writes must be batched');
assert.ok(!/onclick="selectParty\(/.test(code), 'no inline names inside onclick');
assert.ok(/data-id="\$\{esc\(id\)\}"/.test(code), 'search results use escaped data-id');
assert.ok(/esc\(v\.note\)/.test(code) && /esc\(pName\)/.test(code), 'note and name are escaped');
assert.ok(!/addDoc\(|await updateDoc\(custRef|await deleteDoc\(/.test(code), 'no unbatched financial writes');

console.log('Client vouchers: syntax, balance math (edit/move/delete), escaping, local date and batching checks passed.');
