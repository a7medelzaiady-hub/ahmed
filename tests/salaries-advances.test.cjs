// Node 20+: node --test tests/salaries-advances.test.cjs
// Exercises the real inline payroll helpers, not a copied implementation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'salaries-advances.html'), 'utf8');
const moduleMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(moduleMatch, 'Payroll module must be present');
const source = moduleMatch[1];
const executable = source.replace(/^\s*import\s+\{[\s\S]*?\}\s+from\s+"[^"]+";/gm, '');
function segment(first, next) {
    const start = source.indexOf(first);
    const end = source.indexOf(next, start);
    assert.ok(start >= 0 && end > start, 'Missing source segment: ' + first);
    return source.slice(start, end);
}

test('the browser payroll module remains valid JavaScript', () => {
    assert.doesNotThrow(() => new vm.Script(executable));
});

test('six summary cards expand their matching detail panels for the selected month', () => {
    for (const type of ['adv', 'absence', 'deficit', 'nondeductible', 'carryover', 'balance']) {
        assert.ok(html.includes('data-type="' + type + '"'), 'Missing card: ' + type);
        assert.ok(html.includes('aria-controls="panel-' + type + '-${d.id}"'), 'Missing aria-controls: ' + type);
        assert.ok(html.includes('id="panel-' + type + '-${d.id}"'), 'Missing target panel: ' + type);
    }
    assert.ok(html.includes("openPanels.clear()"), 'Month changes should close stale detail panels');
    assert.ok(html.includes("next?.focus({ preventScroll: true })"), 'Keyboard focus must survive rerender');
});

test('carryover is read from a confirmed per-driver, per-month value only', () => {
    const context = { advances: [] };
    vm.runInNewContext(segment('function advancesOf(', 'function calcAllowedLimit('), context);
    assert.equal(context.carryoverOf({}, '2026-11'), 0);
    assert.equal(context.carryoverOf({monthlyCarryovers: {'2026-11': 700}}, '2026-11'), 700);
    assert.equal(context.carryoverOf({monthlyCarryovers: {'2026-11': -250}}, '2026-11'), -250);
    assert.equal(context.carryoverOf({monthlyCarryovers: {'2026-10': 200}}, '2026-11'), 0);
    assert.equal(context.carryoverOf({monthlyCarryovers: {'2026-11': 'invalid'}}, '2026-11'), 0);
});

test('balance includes carryover, deducts signed advances, absence and deficits but not non-deductible expenses', () => {
    const context = { advances: [
        {driverId:'driver1', date:'2025-12-01', amount:500},
        {driverId:'driver1', date:'2025-12-03', amount:-200},
        {driverId:'driver1', date:'2025-12-05', amount:100, isAbsence:true},
        {driverId:'driver1', date:'2025-12-06', amount:50, isDeficit:true},
        {driverId:'driver1', date:'2025-12-09', amount:575, isNonDeductible:true},
        {driverId:'driver1', date:'2025-11-30', amount:999},
        {driverId:'driver2', date:'2025-12-10', amount:800}
    ], Date };
    vm.runInNewContext(segment('function advancesOf(', 'function calcAllowedLimit('), context);
    vm.runInNewContext(segment('function calcAccrualData(', 'onSnapshot(collection(db, DRIVERS_COL)'), context);
    const driver = {id:'driver1', baseSalary:3100, monthlyCarryovers:{'2025-12': -100}};
    const result = context.calcAccrualData(driver, '2025-12');
    assert.equal(result.earnedSoFar, 3100);
    assert.equal(result.carryover, -100);
    assert.equal(result.totalDeductions, 450);
    assert.equal(result.netBalance, 2550);
    assert.equal(context.calcAccrualData({...driver,monthlyCarryovers:{}},'2025-12').netBalance, 2650);
});

test('year boundary and the 28/29/30/31 day months use calendar arithmetic', () => {
    const context = {};
    vm.runInNewContext(segment('function shiftMonthKey(', 'function numberOnly('), context);
    assert.equal(context.shiftMonthKey('2026-01', -1), '2025-12');
    assert.equal(context.shiftMonthKey('2025-12', 1), '2026-01');
    assert.equal(context.shiftMonthKey('2024-02', 12), '2025-02');
});

test('carryover changes are administrator-only and reuse the drivers listener', () => {
    assert.match(source, /async function saveCarryover\(driverId\)\s*\{\s*if \(!isAdmin\) return;/);
    assert.ok(source.includes('[\x60monthlyCarryovers.${currentMonth}\x60]: amount'));
    assert.equal((source.match(/onSnapshot\(collection\(db,/g) || []).length, 2, 'No additional Firestore listener');
});

test('a tapped metric card expands its record directly underneath, shifting later cards down', () => {
    assert.match(html, /\.driver-nums \.inline-detail-panel,\s*\.driver-actions \.inline-detail-panel\s*\{\s*grid-column: 1 \/ -1;/);
    assert.doesNotMatch(html, /\.driver-nums \.accrual-status\s*\{\s*order:\s*-1;/);
    assert.doesNotMatch(html, /\.driver-nums \.net\s*\{\s*order:\s*-2;/);
    assert.ok(source.includes('moveOpenPanelsUnderTriggers();'), 'The inline placement runs after rendering');
    for (const origin of ['card', 'action']) {
        const type = 'adv', driverId = 'd1';
        const metricButton = createButton('detail-card', driverId, type);
        const actionButton = createButton('icon-btn', driverId, type);
        const buttons = [metricButton, actionButton];
        const panel = {
            id: 'panel-' + type + '-' + driverId,
            classList: { add(name) { this[name] = true; } }
        };
        const driverEl = {
            querySelector(selector) {
                assert.equal(selector, '.detail-card');
                return metricButton;
            },
            querySelectorAll(selector) {
                assert.equal(selector, '[data-toggle]');
                return buttons;
            }
        };
        const doc = {
            querySelectorAll(selector) {
                assert.equal(selector, '#driversList .driver');
                return [driverEl];
            },
            getElementById(id) {
                assert.equal(id, panel.id);
                return panel;
            }
        };
        const context = {
            document: doc,
            openPanels: new Map([[driverId, type]]),
            openPanelSources: new Map([[driverId, origin]])
        };
        vm.runInNewContext(segment('function moveOpenPanelsUnderTriggers()', 'function bindDynamicEvents(){'), context);
        context.moveOpenPanelsUnderTriggers();
        const tapped = origin === 'card' ? metricButton : actionButton;
        const untouched = origin === 'card' ? actionButton : metricButton;
        assert.equal(tapped.inserted, panel, 'Panel must be directly behind tapped ' + origin);
        assert.equal(tapped.position, 'afterend');
        assert.equal(tapped.attrs['aria-expanded'], 'true');
        assert.equal(tapped.attrs['aria-controls'], panel.id);
        assert.equal(untouched.inserted, undefined);
        assert.equal(panel.classList['inline-detail-panel'], true);
    }
});

function createButton(className, driverId, type) {
    return {
        classList: { contains(name) { return name === className; } },
        getAttribute(name) {
            return { 'data-toggle': driverId, 'data-type': type }[name] ?? null;
        },
        setAttribute(name, value) {
            this.attrs[name] = value;
        },
        attrs: {},
        insertAdjacentElement(position, panel) {
            this.position = position;
            this.inserted = panel;
        }
    };
}

test('payroll amounts and record labels have larger fonts including on mobile', () => {
    assert.ok(html.includes('.driver-nums .n .k { font-size: 13px;'));
    assert.ok(html.includes('.driver-nums .n .v { font-size: 16px;'));
    assert.ok(html.includes('.driver-nums .n .v { font-size: 15px; }'));
    assert.ok(html.includes('.adv-item { border-radius: 11px; align-items: flex-start; gap: 8px; font-size: 14px; }'));
    assert.ok(html.includes('.advances-panel h3 { font-size: 14px; }'));
});
