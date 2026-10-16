// =====================================================================
// firebase-shim.js
// -----------------------------------------------------------------------
// بديل محلي بالكامل لمكتبة Firebase Firestore (النسخة الـ modular).
// كل البيانات بتتخزن جوه الموبايل نفسه عن طريق IndexedDB، فالبرنامج
// يشتغل 100% من غير إنترنت.
//
// أسماء الدوال والـ signature بتاعها زي "firebase-firestore.js" بالظبط،
// عشان أي صفحة تستوردها من هنا بدل جوجل من غير ما تغيّر باقي الكود.
// =====================================================================

const DB_NAME = "elzaiady_offline_db";
const DB_VERSION = 1;
const STORE = "docs";

let _dbPromise = null;
function openIDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: "_key" });
                store.createIndex("collection", "collection", { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return _dbPromise;
}

// ----------------------- إشعارات التغيير (للـ onSnapshot) -----------------------
const listeners = new Set(); // { collection, cb }
let bc = null;
try { bc = new BroadcastChannel("elzaiady_offline_db_changes"); } catch (e) { /* ignore */ }

function notifyChange(collectionName) {
    listeners.forEach(l => { if (l.collection === collectionName) l.cb(); });
    if (bc) { try { bc.postMessage({ collection: collectionName }); } catch (e) { /* ignore */ } }
}
if (bc) {
    bc.onmessage = (ev) => {
        const collectionName = ev.data && ev.data.collection;
        listeners.forEach(l => { if (l.collection === collectionName) l.cb(); });
    };
}

// ----------------------- توليد ID شبيه بـ Firestore -----------------------
function genId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let id = "";
    for (let i = 0; i < 20; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

// ----------------------- القيم الخاصة (serverTimestamp / increment) -----------------------
export function serverTimestamp() { return { __sentinel: "serverTimestamp" }; }
export function increment(n) { return { __sentinel: "increment", n }; }
export function deleteField() { return { __sentinel: "deleteField" }; }
export function arrayUnion(...items) { return { __sentinel: "arrayUnion", items }; }
export function arrayRemove(...items) { return { __sentinel: "arrayRemove", items }; }

function isSentinel(v, type) {
    return v && typeof v === "object" && v.__sentinel === type;
}

function resolveTimestampsDeep(value) {
    if (isSentinel(value, "serverTimestamp")) return { __ts: Date.now() };
    if (Array.isArray(value)) return value.map(resolveTimestampsDeep);
    if (value && typeof value === "object") {
        const out = {};
        for (const k in value) out[k] = resolveTimestampsDeep(value[k]);
        return out;
    }
    return value;
}

// دمج بيانات جديدة فوق بيانات موجودة، مع حل الـ sentinels (serverTimestamp / increment / arrayUnion...)
function mergeFields(existing, payload) {
    const out = { ...(existing || {}) };
    for (const k in payload) {
        const v = payload[k];
        if (isSentinel(v, "serverTimestamp")) {
            out[k] = { __ts: Date.now() };
        } else if (isSentinel(v, "increment")) {
            const cur = Number(out[k]) || 0;
            out[k] = cur + v.n;
        } else if (isSentinel(v, "deleteField")) {
            delete out[k];
        } else if (isSentinel(v, "arrayUnion")) {
            const cur = Array.isArray(out[k]) ? out[k] : [];
            const merged = [...cur];
            v.items.forEach(it => { if (!merged.some(x => JSON.stringify(x) === JSON.stringify(it))) merged.push(it); });
            out[k] = merged;
        } else if (isSentinel(v, "arrayRemove")) {
            const cur = Array.isArray(out[k]) ? out[k] : [];
            out[k] = cur.filter(x => !v.items.some(it => JSON.stringify(it) === JSON.stringify(x)));
        } else if (Array.isArray(v)) {
            out[k] = v.map(resolveTimestampsDeep);
        } else if (v && typeof v === "object") {
            out[k] = resolveTimestampsDeep(v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

// تحويل { __ts: ms } المخزنة إلى كائن شبيه بـ Firestore Timestamp (فيه toDate())
function reviveTimestamps(value) {
    if (value && typeof value === "object" && "__ts" in value && Object.keys(value).length === 1) {
        const ms = value.__ts;
        return {
            seconds: Math.floor(ms / 1000),
            nanoseconds: (ms % 1000) * 1e6,
            toDate: () => new Date(ms),
            toMillis: () => ms
        };
    }
    if (Array.isArray(value)) return value.map(reviveTimestamps);
    if (value && typeof value === "object") {
        const out = {};
        for (const k in value) out[k] = reviveTimestamps(value[k]);
        return out;
    }
    return value;
}

// ----------------------- عمليات IndexedDB الأساسية -----------------------
async function putRecord(collectionPath, id, data) {
    const idb = await openIDB();
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ _key: `${collectionPath}/${id}`, collection: collectionPath, id, data, updatedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getRecord(collectionPath, id) {
    const idb = await openIDB();
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(`${collectionPath}/${id}`);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function deleteRecord(collectionPath, id) {
    const idb = await openIDB();
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(`${collectionPath}/${id}`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getAllInCollection(collectionPath) {
    const idb = await openIDB();
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, "readonly");
        const idx = tx.objectStore(STORE).index("collection");
        const req = idx.getAll(IDBKeyRange.only(collectionPath));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

// ----------------------- App / Firestore init (dummies) -----------------------
export function initializeApp(config) { return { __app: true, config }; }
export function getFirestore() { return { __firestoreDb: true }; }
export function initializeFirestore() { return { __firestoreDb: true }; }
export function persistentLocalCache(opts) { return opts; }
export function persistentMultipleTabManager() { return {}; }

// ----------------------- References -----------------------
export function collection(_db, path) { return { __type: "collection", path }; }

export function doc(_db, path, id) {
    if (id === undefined) return { __type: "doc", path, id: genId() };
    return { __type: "doc", path, id: String(id) };
}

// ----------------------- CRUD -----------------------
export async function addDoc(colRef, data) {
    const id = genId();
    const finalData = mergeFields({}, data);
    await putRecord(colRef.path, id, finalData);
    notifyChange(colRef.path);
    return { id, path: colRef.path };
}

export async function setDoc(docRef, data, opts) {
    const merge = !!(opts && opts.merge);
    let finalData;
    if (merge) {
        const existingRec = await getRecord(docRef.path, docRef.id);
        finalData = mergeFields(existingRec ? existingRec.data : {}, data);
    } else {
        finalData = mergeFields({}, data);
    }
    await putRecord(docRef.path, docRef.id, finalData);
    notifyChange(docRef.path);
}

export async function updateDoc(docRef, data) {
    const existingRec = await getRecord(docRef.path, docRef.id);
    if (!existingRec) throw new Error(`No document to update: ${docRef.path}/${docRef.id}`);
    const finalData = mergeFields(existingRec.data, data);
    await putRecord(docRef.path, docRef.id, finalData);
    notifyChange(docRef.path);
}

export async function deleteDoc(docRef) {
    await deleteRecord(docRef.path, docRef.id);
    notifyChange(docRef.path);
}

export async function getDoc(docRef) {
    const rec = await getRecord(docRef.path, docRef.id);
    return {
        id: docRef.id,
        exists: () => !!rec,
        data: () => (rec ? reviveTimestamps(rec.data) : undefined),
        ref: docRef
    };
}

// ----------------------- Query -----------------------
export function query(colRef, ...constraints) {
    return { __type: "query", path: colRef.path, constraints };
}
export function where(field, op, value) { return { kind: "where", field, op, value }; }
export function orderBy(field, dir) { return { kind: "orderBy", field, dir: dir || "asc" }; }
export function limit(n) { return { kind: "limit", n }; }

function getFieldValue(data, field) {
    return field.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), data);
}

function unwrapTs(v) {
    return (v && typeof v === "object" && "__ts" in v) ? v.__ts : v;
}

function applyConstraints(records, constraints) {
    let result = records;
    const wheres = constraints.filter(c => c.kind === "where");
    const orderBys = constraints.filter(c => c.kind === "orderBy");
    const limits = constraints.filter(c => c.kind === "limit");

    for (const w of wheres) {
        result = result.filter(r => {
            const v = getFieldValue(r.data, w.field);
            const vv = unwrapTs(v);
            const target = unwrapTs(w.value);
            switch (w.op) {
                case "==": return vv === target;
                case "!=": return vv !== target;
                case "<": return vv < target;
                case "<=": return vv <= target;
                case ">": return vv > target;
                case ">=": return vv >= target;
                case "array-contains": return Array.isArray(v) && v.includes(w.value);
                case "in": return Array.isArray(w.value) && w.value.includes(vv);
                default: return true;
            }
        });
    }

    if (orderBys.length) {
        const o = orderBys[0];
        result = [...result].sort((a, b) => {
            const av = unwrapTs(getFieldValue(a.data, o.field));
            const bv = unwrapTs(getFieldValue(b.data, o.field));
            let cmp = 0;
            if (av < bv) cmp = -1; else if (av > bv) cmp = 1;
            return o.dir === "desc" ? -cmp : cmp;
        });
    }

    if (limits.length) {
        result = result.slice(0, limits[limits.length - 1].n);
    }
    return result;
}

export async function getDocs(refOrQuery) {
    const path = refOrQuery.path;
    let records = await getAllInCollection(path);
    if (refOrQuery.__type === "query") {
        records = applyConstraints(records, refOrQuery.constraints);
    }
    const docs = records.map(r => ({
        id: r.id,
        data: () => reviveTimestamps(r.data),
        exists: () => true,
        ref: { __type: "doc", path, id: r.id }
    }));
    return {
        docs,
        empty: docs.length === 0,
        size: docs.length,
        forEach: (cb) => docs.forEach(cb)
    };
}

// ----------------------- Realtime (onSnapshot) -----------------------
export function onSnapshot(refOrQuery, onNext, onError) {
    let cancelled = false;
    const path = refOrQuery.path;
    const run = async () => {
        if (cancelled) return;
        try {
            const snap = await getDocs(refOrQuery);
            onNext(snap);
        } catch (e) {
            if (onError) onError(e);
        }
    };
    run();
    const listener = { collection: path, cb: run };
    listeners.add(listener);
    return () => { cancelled = true; listeners.delete(listener); };
}

// ----------------------- Transactions / Batches -----------------------
export async function runTransaction(_db, updateFn) {
    const pendingOps = [];
    const txObj = {
        get: (docRef) => getDoc(docRef),
        set: (docRef, data, opts) => pendingOps.push({ type: "set", docRef, data, opts }),
        update: (docRef, data) => pendingOps.push({ type: "update", docRef, data }),
        delete: (docRef) => pendingOps.push({ type: "delete", docRef })
    };
    const result = await updateFn(txObj);
    for (const op of pendingOps) {
        if (op.type === "set") await setDoc(op.docRef, op.data, op.opts);
        else if (op.type === "update") await updateDoc(op.docRef, op.data);
        else if (op.type === "delete") await deleteDoc(op.docRef);
    }
    return result;
}

export function writeBatch(_db) {
    const ops = [];
    return {
        set: (docRef, data, opts) => ops.push({ type: "set", docRef, data, opts }),
        update: (docRef, data) => ops.push({ type: "update", docRef, data }),
        delete: (docRef) => ops.push({ type: "delete", docRef }),
        commit: async () => {
            for (const op of ops) {
                if (op.type === "set") await setDoc(op.docRef, op.data, op.opts);
                else if (op.type === "update") await updateDoc(op.docRef, op.data);
                else if (op.type === "delete") await deleteDoc(op.docRef);
            }
        }
    };
}

// =====================================================================
// أدوات إضافية (مش جزء من Firestore API) بيستخدمها فقط ملف النسخ
// الاحتياطي cloud-backup.js لقراءة/كتابة كل البيانات المحلية دفعة واحدة.
// =====================================================================
export async function __exportAllLocalData() {
    const idb = await openIDB();
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => {
            const all = req.result || [];
            const grouped = {};
            all.forEach(rec => {
                if (!grouped[rec.collection]) grouped[rec.collection] = {};
                grouped[rec.collection][rec.id] = rec.data;
            });
            resolve(grouped);
        };
        req.onerror = () => reject(req.error);
    });
}

export async function __importAllLocalData(grouped, { clearFirst = false } = {}) {
    const idb = await openIDB();
    if (clearFirst) {
        await new Promise((resolve, reject) => {
            const tx = idb.transaction(STORE, "readwrite");
            tx.objectStore(STORE).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
    const tx = idb.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    Object.keys(grouped).forEach(collectionPath => {
        Object.keys(grouped[collectionPath]).forEach(id => {
            store.put({ _key: `${collectionPath}/${id}`, collection: collectionPath, id, data: grouped[collectionPath][id], updatedAt: Date.now() });
        });
    });
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
