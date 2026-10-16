// =====================================================================
// shop-publish.js
// ---------------------------------------------------------------------
// بينشر للمتجر (shop.html) بيانات آمنة للعرض العام فقط:
//   shop_catalog/meta + shop_catalog/c0,c1,...  : أسماء الأصناف وأسعار البيع وصور المخزن (من غير سعر الشراء)
//   shop_accounts/{customerId}                  : اسم التاجر + رصيده الحالي
// طلبات التجار نفسها بتتكتب مباشرة في جدول orders (status: pending, source: shop)
// فبتظهر في all-orders وكشف التحميل وتتحوّل لفاتورة بالطريقة المعتادة.
// =====================================================================
import * as FS from "./firestore-offline.js";
import { __getDb } from "./firestore-offline.js";

const STATE_KEY = "elzaiady_shop_publish_state";
const AUTO_EVERY_MS = 3 * 60 * 60 * 1000;   // النشر التلقائي كل 3 ساعات بحد أقصى
const CHUNK_SIZE = 1200;                    // عدد الأصناف في كل مستند (حد فايربيز 1MB للمستند)

const num = (v) => {
    if (v === null || v === undefined) return 0;
    const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
    return isNaN(n) ? 0 : n;
};
const round2 = (n) => Math.round(n * 100) / 100;
const isDeleted = (d) => !!d && (d.isDeleted === true || d.deleted === true || d.status === "deleted" || d.isCancelled === true);

function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch (_) { return {}; } }
function saveState(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) { /* ignore */ } }
export function getPublishState() { return loadState(); }

async function waitForDb(ms = 6000) {
    const t0 = Date.now();
    while (!__getDb() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 200));
    return __getDb();
}

// ---------------- الكتالوج ----------------
export async function publishCatalog(db, force = false) {
    const snap = await FS.getDocs(FS.collection(db, "makhzan"));
    const items = [];
    snap.forEach((d) => {
        const x = d.data();
        if (isDeleted(x)) return;
        const name = String(x.name || "").trim();
        const sell = round2(num(x.sell));
        if (!name || sell <= 0) return;
        const factor = Math.max(1, Number(x.unitFactor || x.pcsPerCarton || x.factor) || 1);
        const it = { id: d.id, n: name, s: sell, f: factor };
        
        // قراءة الصورة المرفوعة في المخزن بسماحية كاملة (روابط أو Base64)
        const img = String(x.imageUrl || x.image || x.img || "").trim();
        if (img && (img.startsWith("data:image/") || /^https?:\/\//.test(img))) {
            it.img = img;
        }
        
        items.push(it);
    });
    items.sort((a, b) => a.n.localeCompare(b.n, "ar"));

    const payload = JSON.stringify(items);
    const state = loadState();
    if (!force && state.catalogSig === payload.length + ":" + hash(payload)) return { items: items.length, skipped: true };

    const chunks = Math.max(1, Math.ceil(items.length / CHUNK_SIZE));
    for (let i = 0; i < chunks; i++) {
        await FS.setDoc(FS.doc(db, "shop_catalog", "c" + i), { items: items.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) });
    }
    // حذف أجزاء قديمة زادت عن العدد الحالي
    for (let i = chunks; i < (state.chunks || 0); i++) { try { await FS.deleteDoc(FS.doc(db, "shop_catalog", "c" + i)); } catch (_) { /* ignore */ } }
    await FS.setDoc(FS.doc(db, "shop_catalog", "meta"), { count: items.length, chunks, updatedAt: Date.now() });

    state.catalogSig = payload.length + ":" + hash(payload);
    state.chunks = chunks;
    saveState(state);
    return { items: items.length, skipped: false };
}

function hash(str) {   // هاش بسيط لاكتشاف التغيير
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

// ---------------- الأرصدة ----------------
// نفس معادلة صفحة الطلبات: رصيد افتتاحي + باقي الفواتير + (صرف - قبض)
export async function publishBalances(db, force = false) {
    const [custSnap, invSnap, transSnap] = await Promise.all([
        FS.getDocs(FS.collection(db, "customers")),
        FS.getDocs(FS.collection(db, "invoices")),
        FS.getDocs(FS.collection(db, "transactions"))
    ]);

    const invoiceBal = {};
    invSnap.forEach((d) => {
        const x = d.data();
        if (isDeleted(x) || !x.customerId) return;
        invoiceBal[x.customerId] = (invoiceBal[x.customerId] || 0) + num(x.remaining);
    });
    const transBal = {};
    transSnap.forEach((d) => {
        const x = d.data();
        if (isDeleted(x)) return;
        const cid = x.partyId || x.customerId;
        if (!cid) return;
        let eff = 0;
        if (x.type === "قبض") eff = -num(x.amount);
        else if (x.type === "صرف") eff = num(x.amount);
        transBal[cid] = (transBal[cid] || 0) + eff;
    });

    const state = loadState();
    const prev = state.balances || {};
    const next = {};
    const now = Date.now();
    let batch = FS.writeBatch(db), inBatch = 0, written = 0;

    for (const d of custSnap.docs) {
        const x = d.data();
        if (isDeleted(x)) continue;
        const name = String(x.name || "").trim();
        if (!name) continue;
        const initial = num(x.initialBalance ?? x.balance ?? x.debt);
        const balance = round2(initial + (invoiceBal[d.id] || 0) + (transBal[d.id] || 0));
        const sig = name + "|" + balance;
        next[d.id] = sig;
        if (!force && prev[d.id] === sig) continue;
        batch.set(FS.doc(db, "shop_accounts", d.id), { name, balance, updatedAt: now });
        inBatch++; written++;
        if (inBatch >= 400) { await batch.commit(); batch = FS.writeBatch(db); inBatch = 0; }
    }
    if (inBatch) await batch.commit();

    state.balances = next;
    state.at = now;
    saveState(state);
    return { customers: Object.keys(next).length, written };
}

export async function publishAll({ force = false } = {}) {
    const db = await waitForDb();
    if (!db) throw new Error("قاعدة البيانات لسه ما اتهيّأتش.");
    const cat = await publishCatalog(db, force);
    const bal = await publishBalances(db, force);
    return { catalog: cat, balances: bal, at: loadState().at };
}

// نشر تلقائي هادي (بيتنادى من الصفحات اللي المالك بيفتحها يوميًا)
export async function autoPublish() {
    try {
        if (!navigator.onLine) return;
        if (!localStorage.getItem("authGuard_token")) return;
        const st = loadState();
        if (st.at && Date.now() - st.at < AUTO_EVERY_MS) return;
        await publishAll();
    } catch (e) { console.warn("النشر التلقائي للمتجر:", e && e.message); }
}
