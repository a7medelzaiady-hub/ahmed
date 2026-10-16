// =====================================================================
// firestore-offline.js
// ---------------------------------------------------------------------
// طبقة فوق Firebase Firestore الأصلي بتخلي البرنامج يشتغل زي تطبيقات
// الموبايل: كل البيانات بتتحفظ على الجهاز، والبرنامج يشتغل من غير نت،
// وأول ما النت يرجع كل التغييرات بتترفع للسيرفر تلقائيًا.
//
// الصفحات بتستورد من الملف ده بدل رابط gstatic، وكل الدوال الباقية
// (collection, query, onSnapshot ...) بتتصدّر زي ما هي من المكتبة الأصلية.
//
// اللي بيعمله الملف:
//  1) يفعّل التخزين الدائم (IndexedDB) ومتعدد التبويبات في كل الصفحات.
//  2) يمنع تعليق الصفحات: دوال الكتابة (setDoc/addDoc/updateDoc/deleteDoc/
//     writeBatch.commit) كانت بتفضل مستنية رد السيرفر، فبتعلّق وانت أوفلاين.
//     هنا بترجع أول ما الكتابة تتحفظ محليًا، والرفع بيحصل في الخلفية.
//  3) runTransaction بتشتغل أوفلاين (بديل بيقرأ من الجهاز ويكتب بـ batch).
//  4) شريط حالة صغير: بدون نت / جاري الرفع / تمت المزامنة.
//  5) تحميل مسبق (مرة كل 12 ساعة) لكل الجداول وانت أونلاين، عشان تبقى
//     متاحة أوفلاين حتى الصفحات اللي لسه ما فتحتهاش.
// =====================================================================

import * as FS from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

export * from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ----------------------------- إعدادات -----------------------------
const ONLINE_ACK_TIMEOUT_MS = 4000;   // لو السيرفر ما ردّش خلال المدة دي نكمّل (الكتابة محفوظة محليًا)
const OFFLINE_RESOLVE_MS = 30;        // أوفلاين: نكمّل فورًا بعد الحفظ المحلي
const WARM_EVERY_MS = 12 * 60 * 60 * 1000;
const WARM_KEY = "elzaiady_cache_warmed_at";
const WARM_COLLECTIONS = [
    "customers", "suppliers", "invoices", "transactions", "supplier_transactions",
    "inventory", "inventory_transactions", "cash_logs", "expenses", "orders",
    "purchase_orders", "purchases", "returns", "shortages", "installments",
    "categories", "settings", "cash_settings", "wallet_settings", "wallet_entries",
    "cash_manual_entries", "daily_loads", "car_loadings", "archived_profits",
    "accounts", "journalEntries", "daily_cash_register"
];

// الجداول اللي بتدخل في ملف النسخة الاحتياطية (users مستبعد افتراضيًا لأنه فيه كلمات مرور)
export const BACKUP_COLLECTIONS = WARM_COLLECTIONS.concat(["archived_loads", "archived_inventory", "purchases", "sales", "quotations", "products", "payments"])
    .filter((v, i, a) => a.indexOf(v) === i);
export function __getDb() { return firstDb; }

// ----------------------------- قاعدة البيانات -----------------------------
const dbByApp = new WeakMap();
let firstDb = null;

function makeDb(app) {
    let db = dbByApp.get(app);
    if (db) return db;
    try {
        db = FS.initializeFirestore(app, {
            localCache: FS.persistentLocalCache({ tabManager: FS.persistentMultipleTabManager() })
        });
    } catch (e) {
        // اتهيّأت قبل كده (أو المتصفح مش بيدعم IndexedDB) -> استخدم الموجودة
        db = FS.getFirestore(app);
    }
    dbByApp.set(app, db);
    if (!firstDb) { firstDb = db; scheduleStartupTasks(); }
    return db;
}

// الصفحات القديمة بتبعت إعدادات الكاش الخاصة بيها، بنتجاهلها ونوحّد الإعداد.
export function initializeFirestore(app /*, settings */) { return makeDb(app); }
export function getFirestore(app) { return makeDb(app || getApp()); }

// ----------------------------- الكتابة بدون تعليق -----------------------------
let unsyncedWrites = 0;

function offlineSafe(p) {
    unsyncedWrites++;
    setBadge();
    try { window.dispatchEvent(new Event("elzaiady:data-changed")); } catch (_) { /* ignore */ }
    const settle = () => { unsyncedWrites = Math.max(0, unsyncedWrites - 1); refreshSyncState(); };
    const wait = navigator.onLine ? ONLINE_ACK_TIMEOUT_MS : OFFLINE_RESOLVE_MS;
    return new Promise((resolve, reject) => {
        let finished = false;
        const timer = setTimeout(() => { if (!finished) { finished = true; resolve(); } }, wait);
        p.then(
            (v) => { settle(); if (!finished) { finished = true; clearTimeout(timer); resolve(v); } },
            (err) => {
                settle();
                if (!finished) { finished = true; clearTimeout(timer); reject(err); }
                else { console.error("فشل رفع تعديل محفوظ محليًا:", err); showBadge("err", "تعذّر رفع بعض التعديلات للسيرفر (راجع الصلاحيات)"); }
            }
        );
    });
}

export function setDoc(ref, data, options) {
    return offlineSafe(options === undefined ? FS.setDoc(ref, data) : FS.setDoc(ref, data, options));
}
export function updateDoc(ref, ...args) { return offlineSafe(FS.updateDoc(ref, ...args)); }
export function deleteDoc(ref) { return offlineSafe(FS.deleteDoc(ref)); }

export function addDoc(colRef, data) {
    const ref = FS.doc(colRef);                  // ID تلقائي، متاح فورًا حتى أوفلاين
    return offlineSafe(FS.setDoc(ref, data)).then(() => ref);
}

export function writeBatch(db) {
    const batch = FS.writeBatch(db);
    const originalCommit = batch.commit.bind(batch);
    batch.commit = () => offlineSafe(originalCommit());
    return batch;
}

// ----------------------------- المعاملات (Transactions) -----------------------------
export async function runTransaction(db, updateFn, options) {
    if (navigator.onLine) {
        try {
            return await FS.runTransaction(db, updateFn, options);
        } catch (e) {
            if (!e || e.code !== "unavailable") throw e;   // أي خطأ غير انقطاع الشبكة نرميه زي ما هو
        }
    }
    // وضع أوفلاين: نقرأ من الجهاز ونجمّع الكتابات ونحفظها بـ batch واحد
    const ops = [];
    const tx = {
        get: async (ref) => {
            try { return await FS.getDocFromCache(ref); }
            catch (_) { return await FS.getDoc(ref); }
        },
        set: (ref, data, opts) => { ops.push(["set", ref, data, opts]); return tx; },
        update: (ref, ...args) => { ops.push(["update", ref, ...args]); return tx; },
        delete: (ref) => { ops.push(["delete", ref]); return tx; }
    };
    const result = await updateFn(tx);
    const batch = writeBatch(db);
    for (const [kind, ref, ...rest] of ops) {
        if (kind === "set") rest[1] === undefined ? batch.set(ref, rest[0]) : batch.set(ref, rest[0], rest[1]);
        else if (kind === "update") batch.update(ref, ...rest);
        else batch.delete(ref);
    }
    await batch.commit();
    return result;
}

// ----------------------------- شريط حالة المزامنة -----------------------------
let badgeEl = null, hideTimer = null, hadPending = false;

function ensureBadge() {
    if (badgeEl || typeof document === "undefined" || !document.body) return badgeEl;
    badgeEl = document.createElement("div");
    badgeEl.id = "syncStatusBadge";
    badgeEl.style.cssText = "position:fixed;bottom:12px;left:12px;z-index:99999;padding:7px 14px;border-radius:20px;" +
        "font:600 12px Cairo,Tahoma,sans-serif;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35);display:none;" +
        "direction:rtl;pointer-events:none;max-width:80vw;";
    document.body.appendChild(badgeEl);
    return badgeEl;
}

const COLORS = { off: "#b45309", sync: "#1d4ed8", ok: "#15803d", err: "#b91c1c" };

function showBadge(kind, text, autoHideMs) {
    if (!ensureBadge()) { document.addEventListener("DOMContentLoaded", () => showBadge(kind, text, autoHideMs), { once: true }); return; }
    clearTimeout(hideTimer);
    badgeEl.style.background = COLORS[kind] || "#334155";
    badgeEl.textContent = text;
    badgeEl.style.display = "block";
    if (autoHideMs) hideTimer = setTimeout(() => { badgeEl.style.display = "none"; }, autoHideMs);
}
function hideBadge() { if (badgeEl) badgeEl.style.display = "none"; }

function setBadge() {
    if (!navigator.onLine) { hadPending = true; showBadge("off", "📡 بدون إنترنت — بياناتك محفوظة على الجهاز وهتترفع تلقائيًا لما النت يرجع"); }
    else if (unsyncedWrites > 0) { hadPending = true; showBadge("sync", "🔄 جاري رفع التغييرات للسيرفر..."); }
}

let syncCheckId = 0;
async function refreshSyncState() {
    const id = ++syncCheckId;
    if (!firstDb) return;
    if (!navigator.onLine) { setBadge(); return; }
    const slowTimer = setTimeout(() => { if (id === syncCheckId) { hadPending = true; showBadge("sync", "🔄 جاري رفع التغييرات للسيرفر..."); } }, 900);
    try {
        await FS.waitForPendingWrites(firstDb);
        clearTimeout(slowTimer);
        if (id !== syncCheckId) return;
        if (hadPending) { hadPending = false; showBadge("ok", "✅ تمت المزامنة مع السيرفر", 3500); }
        else hideBadge();
    } catch (e) {
        clearTimeout(slowTimer);
    }
}

window.addEventListener("online", () => { showBadge("sync", "🔄 رجع الاتصال — جاري رفع التغييرات..."); refreshSyncState(); warmCache(true); });
window.addEventListener("offline", () => setBadge());

// ----------------------------- تحميل مسبق للكاش -----------------------------
let warming = false;
async function warmCache(force) {
    if (warming || !firstDb || !navigator.onLine) return;
    let last = 0;
    try { last = Number(localStorage.getItem(WARM_KEY) || 0); } catch (_) { /* ignore */ }
    if (!force && Date.now() - last < WARM_EVERY_MS) return;
    if (force && Date.now() - last < 10 * 60 * 1000) return;   // ما نكررش لو لسه حديث
    // ما نحمّلش لو المستخدم مش مسجّل دخول (الصفحة الحالية ممكن تكون صفحة الدخول)
    try { if (!localStorage.getItem("authGuard_token")) return; } catch (_) { return; }

    warming = true;
    let okCount = 0;
    try {
        for (const name of WARM_COLLECTIONS) {
            if (!navigator.onLine) return;
            try { await FS.getDocs(FS.collection(firstDb, name)); okCount++; }
            catch (e) { /* جدول مش موجود أو مفيش صلاحية: نكمّل */ }
        }
        if (okCount > 0) { try { localStorage.setItem(WARM_KEY, String(Date.now())); } catch (_) { /* ignore */ } }
    } finally { warming = false; }
}

function scheduleStartupTasks() {
    const run = () => { refreshSyncState(); setTimeout(() => warmCache(false), 4000); };
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
}

// ----------------------------- تسجيل الـ Service Worker + التحديث التلقائي -----------------------------
function showUpdateBar() {
    if (document.getElementById("swUpdateBar") || !document.body) return;
    const bar = document.createElement("div");
    bar.id = "swUpdateBar";
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:100000;background:#0b5e3d;color:#fff;padding:9px 14px;" +
        "font:700 13px Cairo,Tahoma,sans-serif;text-align:center;direction:rtl;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.4)";
    bar.textContent = "🔄 فيه تحديث جديد للبرنامج — اضغط هنا للتحديث (أو هيتحدّث مع الصفحة الجاية)";
    bar.onclick = () => location.reload();
    document.body.appendChild(bar);
}
try {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "SW_UPDATED") showUpdateBar(); });
        navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
            let lastCheck = 0;
            const check = () => { if (Date.now() - lastCheck > 60 * 1000) { lastCheck = Date.now(); reg.update().catch(() => {}); } };
            check();
            window.addEventListener("online", check);
            document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
        }).catch(() => {});
    }
} catch (_) { /* ignore */ }

// نسخ احتياطي كملف على الموبايل (تلقائي) — وحدة منفصلة
try {
    const loadBackupModule = () => import("./file-backup.js").catch((e) => console.warn("file-backup.js:", e));
    if (document.readyState === "complete") loadBackupModule();
    else window.addEventListener("load", loadBackupModule, { once: true });
} catch (_) { /* ignore */ }

// أدوات يدوية (للإعدادات أو الاختبار من الكونسول)
window.__clearAppCache = async () => { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); location.reload(); };
window.__syncNow = () => { warmCache(true); return refreshSyncState(); };
