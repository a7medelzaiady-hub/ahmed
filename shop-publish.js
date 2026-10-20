// =====================================================================
// shop-publish.js
// ---------------------------------------------------------------------
// بينشر للمتجر (shop.html) بيانات آمنة للعرض العام والخاص:
//   shop_catalog/meta + c0,c1,... : أسماء الأصناف وأسعار البيع الافتراضية والصور
//   shop_accounts/{customerId}    : اسم التاجر + رصيده الحالي + أسعاره الخاصة من فواتيره
// =====================================================================
import * as FS from "./firestore-offline.js";
import { __getDb } from "./firestore-offline.js";

const STATE_KEY = "elzaiady_shop_publish_state";
const AUTO_EVERY_MS = 3 * 60 * 60 * 1000;   // النشر التلقائي كل 3 ساعات
const CHUNK_SIZE = 50;                      // تقسيم الكتالوج
const STATE_VERSION = 2;                    // غيّر الرقم ده لو عدّلت منطق الحساب عشان يتعمل نشر كامل

const num = (v) => {
    if (v === null || v === undefined) return 0;
    const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
    return isNaN(n) ? 0 : n;
};
const round2 = (n) => Math.round(n * 100) / 100;
const isDeleted = (d) => !!d && (d.isDeleted === true || d.deleted === true || d.status === "deleted" || d.isCancelled === true);

// توحيد الاسم (نفس منطق سجل المبيعات) لربط الفواتير اللي من غير customerId
const normName = (s) => String(s || "").trim().replace(/\s+/g, " ")
    .replace(/[\u064B-\u0652]/g, "").replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي").replace(/ة/g, "ه").toLowerCase();

// وقت الفاتورة بالمللي ثانية (يدعم Timestamp و {seconds} و date نصي)
const tsMs = (x) => {
    const t = x.timestamp || x.createdAt;
    if (t && typeof t.toMillis === "function") return t.toMillis();
    if (t && t.seconds) return t.seconds * 1000;
    const d = new Date(x.date || 0).getTime();
    return isNaN(d) ? 0 : d;
};

function loadState() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch (_) { s = {}; }
    // لو الإصدار اتغيّر نمسح بصمات الأرصدة عشان يتنشر كل شيء من جديد
    if (s.version !== STATE_VERSION) {
        s = { version: STATE_VERSION, catalogSig: s.catalogSig, chunks: s.chunks };
    }
    return s;
}
function saveState(s) { try { s.version = STATE_VERSION; localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) { /* ignore */ } }
export function getPublishState() { return loadState(); }

async function waitForDb(ms = 6000) {
    const t0 = Date.now();
    while (!__getDb() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 200));
    return __getDb();
}

// ---------------- الكتالوج الأساسي ----------------
export async function publishCatalog(db, force = false) {
    const snap = await FS.getDocs(FS.collection(db, "inventory"));

    const items = [];
    snap.forEach((d) => {
        const x = d.data();
        if (isDeleted(x)) return;
        const name = String(x.name || "").trim();
        const sell = round2(num(x.sell));
        if (!name || sell <= 0) return;
        const factor = Math.max(1, Number(x.unitFactor || x.pcsPerCarton || x.factor) || 1);
        const it = { id: d.id, n: name, s: sell, f: factor };

        const img = String(x.imageUrl || x.image || "").trim();
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
    for (let i = chunks; i < (state.chunks || 0); i++) { try { await FS.deleteDoc(FS.doc(db, "shop_catalog", "c" + i)); } catch (_) { /* ignore */ } }
    await FS.setDoc(FS.doc(db, "shop_catalog", "meta"), { count: items.length, chunks, updatedAt: Date.now() });

    state.catalogSig = payload.length + ":" + hash(payload);
    state.chunks = chunks;
    saveState(state);
    return { items: items.length, skipped: false };
}

function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

// ---------------- الأرصدة والأسعار المخصصة ----------------
export async function publishBalances(db, force = false) {
    const [custSnap, invSnap, transSnap, invenSnap] = await Promise.all([
        FS.getDocs(FS.collection(db, "customers")),
        FS.getDocs(FS.collection(db, "invoices")),
        FS.getDocs(FS.collection(db, "transactions")),
        FS.getDocs(FS.collection(db, "inventory"))
    ]);

    // 1. معاملات الكرتونة لتوحيد السعر
    const factors = {};
    invenSnap.forEach((d) => {
        const x = d.data();
        factors[d.id] = Math.max(1, Number(x.unitFactor || x.pcsPerCarton || x.factor) || 1);
    });

    // خريطة اسم العميل -> ID (للفواتير اللي من غير customerId)
    const nameToId = {};
    custSnap.forEach((d) => {
        const n = d.data().name;
        if (n) nameToId[normName(n)] = d.id;
    });

    const invoiceBal = {};
    const transBal = {};
    const customerPrices = {}; // { customerId: { stockId: cartonPrice } }

    // 2. تجميع الفواتير وربطها بالعميل (بالـ ID أو بالاسم)
    const allInvoices = [];
    invSnap.forEach((d) => {
        const x = d.data();
        if (isDeleted(x)) return;
        const cid = x.customerId || nameToId[normName(x.customerName)];
        if (!cid) return;
        allInvoices.push({ ...x, _cid: cid });
    });

    // الأحدث أولاً: أول سعر نلاقيه للصنف هو آخر سعر اشترى بيه العميل
    allInvoices.sort((a, b) => tsMs(b) - tsMs(a));

    allInvoices.forEach((x) => {
        // المديونيات (زي ما كانت: بس للفواتير المربوطة بـ customerId)
        if (x.customerId) invoiceBal[x.customerId] = (invoiceBal[x.customerId] || 0) + num(x.remaining);

        // آخر سعر لكل صنف
        if (!customerPrices[x._cid]) customerPrices[x._cid] = {};
        (x.items || []).forEach((item) => {
            if (item.isReturn) return;                       // المرتجع مش سعر شراء
            const sid = item.stockId || item.id;
            if (!sid || customerPrices[x._cid][sid]) return; // اتسجل سعر أحدث قبل كده

            const factor = factors[sid] || Math.max(1, Number(item.unitFactor || item.pcsPerCarton || item.factor) || 1);
            const u = String(item.unit || item.unitName || "").trim().toLowerCase();
            const isCarton = item.isCarton === true || ["box", "carton", "كرتونة", "كرتونه"].includes(u);
            const price = Number(item.price) || 0;

            // توحيد السعر ليكون سعر الكرتونة (زي ما المتجر بيعرض)
            const cartonPrice = isCarton ? price : price * factor;
            if (cartonPrice > 0) customerPrices[x._cid][sid] = round2(cartonPrice);
        });
    });

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
        const customPrices = customerPrices[d.id] || {};

        // البصمة بتشمل الأسعار الفعلية عشان أي تغيير في السعر يتنشر
        const sig = name + "|" + balance + "|" + JSON.stringify(customPrices);
        next[d.id] = sig;

        if (!force && prev[d.id] === sig) continue;

        batch.set(FS.doc(db, "shop_accounts", d.id), { name, balance, customPrices, updatedAt: now });
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

export async function autoPublish() {
    try {
        if (!navigator.onLine) return;
        if (!localStorage.getItem("authGuard_token")) return;
        const st = loadState();
        if (st.at && Date.now() - st.at < AUTO_EVERY_MS) return;
        await publishAll();
    } catch (e) { console.warn("النشر التلقائي للمتجر:", e && e.message); }
}
