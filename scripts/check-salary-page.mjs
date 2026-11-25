import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const html = readFileSync(new URL('../salaries-advances.html', import.meta.url), 'utf8');
const moduleMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert(moduleMatch, 'Firebase page module must exist');
const source = moduleMatch[1];

// Check the full page JavaScript syntax without downloading or executing Firebase.
const directory = mkdtempSync(join(tmpdir(), 'salary-page-'));
try {
  const moduleFile = join(directory, 'page.mjs');
  writeFileSync(moduleFile, source);
  const check = spawnSync(process.execPath, ['--check', moduleFile], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || 'Invalid JavaScript module');
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const monthHelper = source.match(/    function shiftMonthKey\(ym, offset\) \{[\s\S]*?\n    \}/);
assert(monthHelper, 'Month step helper must exist');
const shiftMonthKey = new Function(monthHelper[0] + '\nreturn shiftMonthKey;')();
for (const [month, offset, expected] of [
  ['2026-11', -1, '2026-10'],
  ['2026-11', +1, '2026-12'],
  ['2026-12', +1, '2027-01'],
  ['2026-01', -1, '2025-12'],
  ['2024-02', +1, '2024-03'],
  ['2024-03', -1, '2024-02'],
]) {
  assert.equal(shiftMonthKey(month, offset), expected);
}
assert.match(source, /currentMonth = shiftMonthKey\(currentMonth, -1\)/);
assert.match(source, /currentMonth = shiftMonthKey\(currentMonth, 1\)/);
assert.doesNotMatch(source, /new Date\(y, m(?:-2)?, 1\)\.toISOString/);
assert.match(source, /let currentMonth = localMonthKey\(\)/);
assert.equal((source.match(/value="\$\{visibleMonthInputDate\(\)\}"/g) || []).length, 4);
assert.equal((source.match(/dateEl\.value \|\| visibleMonthInputDate\(\)/g) || []).length, 4);
for (const id of ['prevMonth', 'nextMonth']) {
  assert.match(html, new RegExp('id="' + id + '"[^>]+aria-label='));
}
for (const id of ['statSalary', 'statAdv', 'statNet']) {
  assert.match(html, new RegExp('id="' + id + '"'));
}
assert.match(html, /\.driver-nums \{ grid-template-columns: repeat\(2,minmax\(0,1fr\)\); \}/);
assert.match(html, /\.form-row \{ grid-template-columns: repeat\(2,minmax\(0,1fr\)\); \}/);
// Signed advances represent adjustments/refunds as well as ordinary cash advances.
const signedAmountInput = html.match(/<input[^>]*id="advAmount-\$\{d\.id\}"[^>]*>/);
assert(signedAmountInput, 'Signed advance input must exist');
assert.doesNotMatch(signedAmountInput[0], /\bmin\s*=/, 'Signed advance input must not have min=0');
assert.match(signedAmountInput[0], /step="any"/);
const validFn = source.match(/    function isValidAdvanceAmount\(amount\) \{[\s\S]*?\n    \}/);
const exceptionFn = source.match(/    function requiresAdvanceException\(amount, newTotal, limit\) \{[\s\S]*?\n    \}/);
assert(validFn && exceptionFn, 'Signed advance helpers must exist');
const { isValidAdvanceAmount, requiresAdvanceException } = new Function(
  validFn[0] + '\n' + exceptionFn[0] + '\nreturn { isValidAdvanceAmount, requiresAdvanceException };'
)();
assert.equal(isValidAdvanceAmount(500), true);
assert.equal(isValidAdvanceAmount(-500), true);
assert.equal(isValidAdvanceAmount(0), false);
assert.equal(isValidAdvanceAmount(NaN), false);
assert.equal(isValidAdvanceAmount(Infinity), false);
assert.equal(requiresAdvanceException(500, 2500, 2000), true);
assert.equal(requiresAdvanceException(500, 1500, 2000), false);
assert.equal(requiresAdvanceException(-500, 2500, 2000), false, 'Refunds should never trigger an over-limit modal');
assert.equal(3000 + -500, 2500, 'Refund must reduce the signed monthly advance sum');
assert.equal(7500 - (3000 + -500), 5000, 'Refund must increase net salary accordingly');
assert.match(source, /if \(!isValidAdvanceAmount\(amount\)\)/);
assert.match(source, /if\(requiresAdvanceException\(amount, newTotal, limit\)\)/);
assert.match(html, /badge-credit[^>]*>تسوية سلفة</);
console.log('Salary page: syntax, navigation, signed advances, calculations and responsive layout checks passed.');
