import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../sales-commissions.html", import.meta.url), "utf8");
const js = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(js, "Missing page module");
const runnable = js.replace(/import\s+(?:\{[\s\S]*?\}|\w+)\s+from\s+["'][^"']+["'];/g, "");
new vm.Script(runnable, { filename: "sales-commissions-inline.js" });

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, "Duplicate HTML IDs");
assert.ok(html.includes('id="customersSection"') && html.includes('id="commissionPanel"'));
assert.ok(html.includes('id="loadMoreCustomersButton"'));
assert.match(runnable, /const CUSTOMERS_PAGE_SIZE = 24;/);
assert.match(runnable, /orderBy\(documentId\(\)\), limit\(CUSTOMERS_PAGE_SIZE\)/);
assert.match(runnable, /startAfter\(lastCustomerDoc\)/);
assert.match(runnable, /await Promise\.all\(\[ensureAllCustomersLoaded\(\), ensureInventoryData\(\)\]\)/);

function element() {
    return {
        value: "", textContent: "", innerText: "", innerHTML: "",
        hidden: false, disabled: false, style: {},
        classList: { toggle() {} },
        addEventListener() {}, setAttribute() {}, closest() { return null; }
    };
}
const elements = Object.fromEntries(ids.map(id => [id, element()]));
const document = { getElementById(id) {
    assert.ok(elements[id], "Unknown element: " + id);
    return elements[id];
} };
const customers = Array.from({ length: 60 }, (_, i) => ({
    id: "c" + String(i + 1).padStart(3, "0"),
    name: "عميل " + (i + 1),
    assignedTo: i === 59 ? "repC" : "repA",
    balance: 0
}));
const invoices = [{
    id: "inv1", customerId: "c001", timestamp: new Date().toISOString(),
    cashAmount: 100, walletAmount: 50,
    items: [{ name: "زيت", qty: 1, price: 100, unit: "قطعة" }]
}];
const transactions = [{
    id: "receipt1", partyId: "c001", type: "قبض",
    amount: 20, method: "كاش", timestamp: new Date().toISOString()
}];
const collections = {
    customers, users: [{ id: "userA", username: "repA" }, { id: "userB", username: "repB" }],
    invoices, transactions,
    inventory: [{ id: "item1", name: "زيت", buy: 60, unitFactor: 1 }],
    commission_settlements: []
};
const reads = [];
const writes = [];
const firestore = {
    initializeApp: () => ({}), initializeFirestore: () => ({}),
    collection: (db, name) => ({ name }),
    doc: (db, name, id) => ({ name, id }),
    query: (...parts) => ({ name: parts[0].name, parts: parts.slice(1) }),
    orderBy: key => ({ orderBy: key }), documentId: () => "__name__",
    where: (key, operator, value) => ({ where: [key, operator, value] }),
    limit: n => ({ limit: n }), startAfter: snapshot => ({ after: snapshot.id }),
    serverTimestamp: () => new Date(),
    addDoc: async () => ({}),
    updateDoc: async (ref, patch) => { writes.push({ ref, patch }); },
    getDocs: async ref => {
        reads.push(ref.name);
        let docs = collections[ref.name] || [];
        const filters = ref.parts || [];
        const after = filters.find(part => "after" in part)?.after;
        if (after) docs = docs.filter(d => d.id > after);
        const typeFilter = filters.find(part => "where" in part)?.where;
        if (typeFilter) docs = docs.filter(d => d[typeFilter[0]] === typeFilter[2]);
        const pageLimit = filters.find(part => "limit" in part)?.limit;
        if (pageLimit) docs = docs.slice(0, pageLimit);
        const resultDocs = docs.map(d => ({ id: d.id, data: () => ({ ...d }) }));
        return {
            docs: resultDocs, size: resultDocs.length, empty: !resultDocs.length,
            forEach(callback) { resultDocs.forEach(callback); }
        };
    }
};
const context = vm.createContext({
    ...firestore, document, window: {}, console,
    localStorage: { getItem: () => null },
    sessionStorage: { getItem: () => null },
    setTimeout: () => 1, clearTimeout() {},
    alert(message) { throw new Error("Unexpected alert: " + message); },
    confirm: () => true
});
new vm.Script(runnable).runInContext(context);
const tick = () => new Promise(resolve => setImmediate(resolve));
await tick();

assert.equal(reads.filter(name => name === "customers").length, 1, "First view should fetch only one customer page");
assert.equal(reads.filter(name => name === "inventory" || name === "invoices").length, 0,
    "First view must not fetch stock or invoices");
assert.match(elements.customersCount.textContent, /24/);
assert.equal((elements.customersCardsContainer.innerHTML.match(/class="customer-card-item"/g) || []).length, 24);

await context.window.loadMoreCustomers();
assert.equal((elements.customersCardsContainer.innerHTML.match(/class="customer-card-item"/g) || []).length, 48);
assert.equal(reads.filter(name => name === "customers").length, 2);

context.window.setActiveTab("commissions");
await tick();
assert.ok(!elements.commissionPanel.hidden && elements.customersSection.hidden);
assert.equal(elements.salesRepFilterSelect.disabled, false);
assert.ok(context.systemUsersSet.has("repC"), "Representatives from the remainder must be available");
assert.equal(reads.filter(name => name === "customers").length, 3);
assert.equal(reads.filter(name => name === "invoices").length, 0);

elements.searchCustomerInput.value = "عميل 60";
await context.window.filterCustomers();
assert.equal((elements.customersCardsContainer.innerHTML.match(/class="customer-card-item"/g) || []).length, 1);
elements.searchCustomerInput.value = "";
await context.window.filterCustomers();

elements.salesRepFilterSelect.value = "repA";
elements.commissionRateInput.value = "2";
await context.window.calculateCommissionReport();
const report = vm.runInContext("currentCalculatedReportData", context);
assert.ok(report, "Report must be generated");
assert.equal(report.customerCount, 59);
assert.equal(report.grandTotalCollected, 170);
assert.equal(report.totalRealNetProfit, 40);
assert.ok(Math.abs(report.netCommissionPaid - 3.4) < 0.001);
assert.ok(Math.abs(report.netProfitAfterCommission - 36.6) < 0.001);
assert.equal(reads.filter(name => name === "inventory").length, 1);
assert.equal(reads.filter(name => name === "invoices").length, 1);

const selectBox = { value: "repB" };
const card = { querySelector: () => selectBox };
const button = { disabled: false, closest: () => card };
await context.window.saveCustomerAssignment("c001", button);
assert.equal(writes.length, 1);
assert.equal(writes[0].ref.id, "c001");
assert.equal(writes[0].patch.assignedTo, "repB");
console.log("PASS: compact layout, lazy loading, paging, complete reps, search, financial report, assignments");
