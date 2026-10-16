// =====================================================================
// file-backup.js
// ---------------------------------------------------------------------
// حفظ نسخة من كل بيانات البرنامج في ملف JSON على الموبايل، وتحديثه
// تلقائيًا بعد كل تعديل، مع الاسترجاع منه.
//
// أماكن الحفظ (بالترتيب حسب البيئة):
//  1) تطبيق الأندرويد (Capacitor): ملف حقيقي في ذاكرة الموبايل
//     (Documents/Elzaiady/backup.json) + نسخة يومية بتاريخ (آخر 7 أيام).
//  2) المتصفح اللي بيدعم File System Access: المستخدم يختار ملف مرة واحدة
//     والبرنامج يحدّثه بعد كده (قد يطلب إذن في كل جلسة).
//  3) أي متصفح تاني: تحميل الملف يدويًا من صفحة النسخ الاحتياطي.
//
// ملحوظة: قاعدة البيانات الشغّالة نفسها لسه على تخزين الجهاز (IndexedDB)
// لأن مكتبة فايربيز مش بتقدر تشتغل على ملف مباشرة. الملف نسخة بتتحدّث
// أوتوماتيك وتقدر ترجع منها لو البيانات اتمسحت.
// =====================================================================

import * as FS from "./firestore-offline.js";
import { __getDb, BACKUP_COLLECTIONS } from "./firestore-offline.js";

// ----------------------------- إعدادات -----------------------------
const INCLUDE_USERS = false;            // true = يضم جدول المستخدمين (فيه كلمات مرور) في الملف
const AUTO_DELAY_MS = 45 * 1000;        // ننتظر بعد آخر تعديل قبل ما نحفظ الملف
const MIN_INTERVAL_MS = 60 * 1000;      // أقل فاصل بين نسختين تلقائيتين
const KEEP_DAILY_COPIES = 7;
const FOLDER = "Elzaiady";
const MAIN_FILE = "backup.json";
const K_LAST = "elzaiady_file_backup_last";
const K_ERR = "elzaiady_file_backup_error";
const K_DIR = "elzaiady_native_dir";
const K_AUTO_DL = "elzaiady_auto_download";   // "off" لإيقاف التحميل اليومي التلقائي

const cap = window.Capacitor;
const isNative = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
const NativeFS = isNative && cap.Plugins ? cap.Plugins.Filesystem : null;
const hasFSA = typeof window.showSaveFilePicker === "function";

const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* ignore */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } }
};

// ----------------------------- ترميز/فك ترميز أنواع فايربيز -----------------------------
export function encode(v) {
    if (v === null || v === undefined) return v === undefined ? null : v;
    if (typeof v !== "object") return v;
    if (typeof FS.Timestamp === "function" && v instanceof FS.Timestamp) return { __t: "ts", s: v.seconds, n: v.nanoseconds };
    if (typeof FS.GeoPoint === "function" && v instanceof FS.GeoPoint) return { __t: "geo", lat: v.latitude, lng: v.longitude };
    if (v.type === "document" && typeof v.path === "string" && v.firestore) return { __t: "ref", path: v.path };
    if (Array.isArray(v)) return v.map(encode);
    const out = {};
    for (const k of Object.keys(v)) out[k] = encode(v[k]);
    return out;
}

export function decode(v, db) {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((x) => decode(x, db));
    if (v.__t === "ts") return new FS.Timestamp(v.s, v.n);
    if (v.__t === "geo") return new FS.GeoPoint(v.lat, v.lng);
    if (v.__t === "ref") return FS.doc(db, v.path);
    // ملفات النسخ القديمة (من صفحة backup.html القديمة) كانت بتحفظ Timestamp كـ {seconds, nanoseconds}
    const keys = Object.keys(v);
    if (keys.length === 2 && typeof v.seconds === "number" && typeof v.nanoseconds === "number") return new FS.Timestamp(v.seconds, v.nanoseconds);
    const out = {};
    for (const k of keys) out[k] = decode(v[k], db);
    return out;
}

// ----------------------------- تجميع البيانات -----------------------------
export async function collectData({ fromServer = false, onProgress } = {}) {
    const db = __getDb();
    if (!db) throw new Error("قاعدة البيانات لسه ما اتهيّأتش في الصفحة دي.");
    const names = BACKUP_COLLECTIONS.filter((n) => INCLUDE_USERS || n !== "users");
    const out = { format: 2, app: "elzaiady", generatedAt: new Date().toISOString(), collections: {} };
    let total = 0, i = 0;
    for (const name of names) {
        i++;
        if (onProgress) onProgress(name, i, names.length);
        try {
            const ref = FS.collection(db, name);
            const snap = (fromServer && navigator.onLine) ? await FS.getDocs(ref) : await FS.getDocsFromCache(ref);
            if (snap.empty) continue;
            out.collections[name] = snap.docs.map((d) => ({ id: d.id, data: encode(d.data()) }));
            total += snap.size;
        } catch (e) { /* الجدول مش موجود أو مش متخزن: نكمّل */ }
    }
    out.totalDocs = total;
    return out;
}

// ----------------------------- الحفظ على أندرويد (ملف حقيقي) -----------------------------
const NATIVE_DIRS = ["DOCUMENTS", "EXTERNAL", "DATA"];

async function nativeWrite(name, text) {
    try { await NativeFS.requestPermissions(); } catch (_) { /* أندرويد 11+ مش بيحتاجها */ }
    const preferred = ls.get(K_DIR);
    const order = preferred ? [preferred, ...NATIVE_DIRS.filter((d) => d !== preferred)] : NATIVE_DIRS;
    let lastErr;
    for (const directory of order) {
        try {
            await NativeFS.writeFile({ path: `${FOLDER}/${name}`, data: text, directory, encoding: "utf8", recursive: true });
            ls.set(K_DIR, directory);
            return directory;
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("تعذّر الكتابة في ذاكرة الموبايل");
}

async function nativeRead(name) {
    const preferred = ls.get(K_DIR);
    const order = preferred ? [preferred, ...NATIVE_DIRS.filter((d) => d !== preferred)] : NATIVE_DIRS;
    for (const directory of order) {
        try {
            const r = await NativeFS.readFile({ path: `${FOLDER}/${name}`, directory, encoding: "utf8" });
            return typeof r.data === "string" ? r.data : await r.data.text();
        } catch (_) { /* جرّب المكان التاني */ }
    }
    return null;
}

async function nativeRotate(directory) {
    try {
        const { files } = await NativeFS.readdir({ path: FOLDER, directory });
        const names = files.map((f) => (typeof f === "string" ? f : f.name)).filter((n) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
        const extra = names.slice(0, Math.max(0, names.length - KEEP_DAILY_COPIES));
        for (const n of extra) { try { await NativeFS.deleteFile({ path: `${FOLDER}/${n}`, directory }); } catch (_) { /* ignore */ } }
    } catch (_) { /* ignore */ }
}

// ----------------------------- الحفظ في المتصفح (File System Access) -----------------------------
function idb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open("elzaiady_backup_handle", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("h");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function getHandle() {
    try {
        const db = await idb();
        return await new Promise((res) => { const r = db.transaction("h").objectStore("h").get("file"); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
    } catch (_) { return null; }
}
async function setHandle(h) {
    const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction("h", "readwrite"); tx.objectStore("h").put(h, "file"); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

export async function chooseBackupFile() {
    if (!hasFSA) throw new Error("المتصفح ده مش بيدعم اختيار ملف للحفظ التلقائي. استخدم التحميل اليدوي، أو تطبيق الأندرويد.");
    const handle = await window.showSaveFilePicker({
        suggestedName: "elzaiady-backup.json",
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
    });
    await setHandle(handle);
    return handle.name;
}

export async function grantAccess() {
    const h = await getHandle();
    if (!h) throw new Error("لسه ما اخترتش ملف للنسخ الاحتياطي.");
    return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

async function webHandleWrite(text) {
    const h = await getHandle();
    if (!h) return null;
    if ((await h.queryPermission({ mode: "readwrite" })) !== "granted") {
        const e = new Error("محتاج إذنك لتحديث ملف النسخة الاحتياطية — افتح صفحة النسخ الاحتياطي واضغط «السماح».");
        e.code = "needs-permission";
        throw e;
    }
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
    return h.name;
}

function downloadFile(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ----------------------------- النسخ الاحتياطي -----------------------------
let running = false;

export async function backupNow({ fromServer = false, allowDownload = false, onProgress } = {}) {
    if (running) return null;
    running = true;
    try {
        const data = await collectData({ fromServer, onProgress });
        const text = JSON.stringify(data);
        let where;
        if (NativeFS) {
            const dir = await nativeWrite(MAIN_FILE, text);
            const day = new Date().toISOString().slice(0, 10);
            await nativeWrite(`backup-${day}.json`, text);
            await nativeRotate(dir);
            where = `ذاكرة الموبايل (${dir === "DOCUMENTS" ? "Documents" : dir}/${FOLDER}/${MAIN_FILE})`;
        } else {
            const name = await webHandleWrite(text);
            if (name) where = `الملف: ${name}`;
            else if (allowDownload) {
                const d = new Date();
                downloadFile(`elzaiady-backup_${d.toISOString().slice(0, 10)}_${d.getHours()}-${d.getMinutes()}.json`, text);
                where = "تحميلات الجهاز";
            } else return null;
        }
        ls.set(K_LAST, JSON.stringify({ at: Date.now(), docs: data.totalDocs, where }));
        ls.del(K_ERR);
        return { docs: data.totalDocs, where };
    } catch (e) {
        ls.set(K_ERR, String(e && e.message || e));
        throw e;
    } finally { running = false; }
}

// ----------------------------- الاسترجاع -----------------------------
export async function restoreFromObject(obj, onProgress) {
    const db = __getDb();
    if (!db) throw new Error("قاعدة البيانات لسه ما اتهيّأتش.");
    const cols = (obj && obj.collections) || {};
    const entries = Object.entries(cols).filter(([, arr]) => Array.isArray(arr));
    let total = 0; entries.forEach(([, arr]) => { total += arr.length; });
    if (!total) throw new Error("الملف مفيهوش بيانات صالحة.");
    let done = 0;
    for (const [name, arr] of entries) {
        for (let i = 0; i < arr.length; i += 400) {
            const batch = FS.writeBatch(db);
            arr.slice(i, i + 400).forEach((d) => batch.set(FS.doc(db, name, d.id), decode(d.data, db)));
            await batch.commit();
            done += Math.min(400, arr.length - i);
            if (onProgress) onProgress(done, total, name);
        }
    }
    return { done, total };
}

export async function restoreFromFile(file, onProgress) {
    return restoreFromObject(JSON.parse(await file.text()), onProgress);
}

export async function readDeviceBackup() {
    if (NativeFS) { const t = await nativeRead(MAIN_FILE); return t ? JSON.parse(t) : null; }
    const h = await getHandle();
    if (h && (await h.queryPermission({ mode: "read" })) === "granted") return JSON.parse(await (await h.getFile()).text());
    return null;
}

export async function restoreFromDevice(onProgress) {
    const obj = await readDeviceBackup();
    if (!obj) throw new Error("مفيش ملف نسخة احتياطية على الجهاز.");
    return restoreFromObject(obj, onProgress);
}

// ----------------------------- حالة الميزة -----------------------------
export async function getStatus() {
    let last = null; try { last = JSON.parse(ls.get(K_LAST) || "null"); } catch (_) { /* ignore */ }
    const hasHandle = !isNative && hasFSA && !!(await getHandle());
    return {
        mode: isNative ? "native" : (hasHandle ? "file-handle" : "download-only"),
        isNative, hasFSA, hasHandle,
        auto: isNative || hasHandle,
        last, lastError: ls.get(K_ERR)
    };
}

// ----------------------------- التشغيل التلقائي -----------------------------
let timer = null, dirty = false, lastRun = 0;

async function autoEnabled() { return isNative || !!(hasFSA && await getHandle()); }

async function runAuto() {
    timer = null;
    if (!dirty || !(await autoEnabled())) return;
    if (Date.now() - lastRun < MIN_INTERVAL_MS) { schedule(); return; }
    lastRun = Date.now(); dirty = false;
    try { await backupNow(); } catch (e) { dirty = true; console.warn("النسخ التلقائي فشل:", e && e.message); }
}
function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(runAuto, delay == null ? AUTO_DELAY_MS : delay);
}

window.addEventListener("elzaiady:data-changed", () => { dirty = true; schedule(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && dirty) schedule(0); });

// عند الفتح: لو أندرويد وآخر نسخة أقدم من 6 ساعات، اعمل نسخة. ولو الجهاز فاضي وأوفلاين اعرض الاسترجاع.
async function startup() {
    const token = ls.get("authGuard_token");
    if (!token) return;                       // صفحة الدخول أو مفيش جلسة
    let last = null; try { last = JSON.parse(ls.get(K_LAST) || "null"); } catch (_) { /* ignore */ }
    if (isNative && (!last || Date.now() - last.at > 6 * 3600 * 1000)) { dirty = true; schedule(8000); }

    // متصفح عادي بدون ملف مختار: تحميل ملف JSON تلقائيًا مرة كل يوم (وانت أونلاين) من أول فتح
    if (!isNative && ls.get(K_AUTO_DL) !== "off" && navigator.onLine && !(hasFSA && await getHandle())) {
        const dayMs = 24 * 3600 * 1000;
        if (!last || Date.now() - last.at > dayMs) {
            setTimeout(async () => {
                try { await backupNow({ fromServer: true, allowDownload: true }); }
                catch (e) { console.warn("التحميل اليومي فشل:", e && e.message); }
            }, 12000);
        }
    }

    // استرجاع تلقائي مقترح: بيانات الجهاز فاضية + مفيش نت + فيه ملف نسخة (يعني بعد مسح بيانات/إعادة تثبيت)
    if (isNative && !navigator.onLine && !sessionStorage.getItem("elzaiady_restore_asked")) {
        sessionStorage.setItem("elzaiady_restore_asked", "1");
        try {
            const db = __getDb(); if (!db) return;
            const [c, i] = await Promise.all(["customers", "inventory"].map((n) => FS.getDocsFromCache(FS.collection(db, n)).then((s) => s.size).catch(() => 0)));
            if (c + i === 0) {
                const obj = await readDeviceBackup();
                if (obj && confirm("بيانات البرنامج على الجهاز فاضية، ولقينا نسخة احتياطية محفوظة. تحب نسترجعها دلوقتي؟")) {
                    const r = await restoreFromObject(obj);
                    alert(`تم استرجاع ${r.done} مستند من الملف.`);
                    location.reload();
                }
            }
        } catch (e) { console.warn("فحص الاسترجاع:", e && e.message); }
    }
}
setTimeout(startup, 6000);

window.ElzaiadyBackup = { setAutoDownload: (on) => (on ? ls.del(K_AUTO_DL) : ls.set(K_AUTO_DL, "off")), isNative, hasFSA, getStatus, backupNow, chooseBackupFile, grantAccess, restoreFromFile, restoreFromDevice, readDeviceBackup, collectData };
