// =====================================================================
// firebase-compat-shim.js
// -----------------------------------------------------------------------
// نفس فكرة firebase-shim.js لكن بصيغة الـ "compat" (global `firebase`
// object) عشان الصفحات القليلة اللي بتحمّل الفايربيز بـ <script src="...">
// عادي مش بصيغة ES module. البيانات بتتخزن في نفس قاعدة IndexedDB
// المستخدمة في باقي التطبيق (elzaiady_offline_db) فكل الصفحات بتشوف
// نفس البيانات.
// =====================================================================
(function () {
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

    const listeners = new Set();
    let bc = null;
    try { bc = new BroadcastChannel("elzaiady_offline_db_changes"); } catch (e) { /* ignore */ }
    function notifyChange(collectionName) {
        listeners.forEach(l => { if (l.collection === collectionName) l.cb(); });
        if (bc) { try { bc.postMessage({ collection: collectionName }); } catch (e) { /* ignore */ } }
    }
    if (bc) {
        bc.onmessage = (ev) => {
            const c = ev.data && ev.data.collection;
            listeners.forEach(l => { if (l.collection === c) l.cb(); });
        };
    }

    function genId() {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let id = "";
        for (let i = 0; i < 20; i++) id += chars[Math.floor(Math.random() * chars.length)];
        return id;
    }

    function isSentinel(v, type) { return v && typeof v === "object" && v.__sentinel === type; }

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

    function reviveTimestamps(value) {
        if (value && typeof value === "object" && "__ts" in value && Object.keys(value).length === 1) {
            const ms = value.__ts;
            return { seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6, toDate: () => new Date(ms), toMillis: () => ms };
        }
        if (Array.isArray(value)) return value.map(reviveTimestamps);
        if (value && typeof value === "object") {
            const out = {};
            for (const k in value) out[k] = reviveTimestamps(value[k]);
            return out;
        }
        return value;
    }

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

    function unwrapTs(v) { return (v && typeof v === "object" && "__ts" in v) ? v.__ts : v; }
    function getFieldValue(data, field) { return field.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), data); }

    function applyConstraints(records, constraints) {
        let result = records;
        const wheres = constraints.filter(c => c.kind === "where");
        const orderBys = constraints.filter(c => c.kind === "orderBy");
        const limits = constraints.filter(c => c.kind === "limit");
        for (const w of wheres) {
            result = result.filter(r => {
                const vv = unwrapTs(getFieldValue(r.data, w.field));
                const target = unwrapTs(w.value);
                switch (w.op) {
                    case "==": return vv === target;
                    case "!=": return vv !== target;
                    case "<": return vv < target;
                    case "<=": return vv <= target;
                    case ">": return vv > target;
                    case ">=": return vv >= target;
                    case "array-contains": return Array.isArray(getFieldValue(r.data, w.field)) && getFieldValue(r.data, w.field).includes(w.value);
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
        if (limits.length) result = result.slice(0, limits[limits.length - 1].n);
        return result;
    }

    function makeDocSnap(path, id, rec) {
        return {
            id,
            exists: rec ? true : false,
            data: () => (rec ? reviveTimestamps(rec.data) : undefined),
            ref: makeDocRef(path, id)
        };
    }

    function makeQuerySnap(path, records) {
        const docs = records.map(r => makeDocSnap(path, r.id, r));
        return {
            docs,
            empty: docs.length === 0,
            size: docs.length,
            forEach: (cb) => docs.forEach(cb)
        };
    }

    function makeDocRef(path, id) {
        return {
            id,
            path: `${path}/${id}`,
            get: async () => {
                const rec = await getRecord(path, id);
                return makeDocSnap(path, id, rec);
            },
            set: async (data, opts) => {
                const merge = !!(opts && opts.merge);
                let finalData;
                if (merge) {
                    const existingRec = await getRecord(path, id);
                    finalData = mergeFields(existingRec ? existingRec.data : {}, data);
                } else {
                    finalData = mergeFields({}, data);
                }
                await putRecord(path, id, finalData);
                notifyChange(path);
            },
            update: async (data) => {
                const existingRec = await getRecord(path, id);
                if (!existingRec) throw new Error(`No document to update: ${path}/${id}`);
                const finalData = mergeFields(existingRec.data, data);
                await putRecord(path, id, finalData);
                notifyChange(path);
            },
            delete: async () => {
                await deleteRecord(path, id);
                notifyChange(path);
            },
            collection: (subPath) => makeCollectionRef(`${path}/${id}/${subPath}`)
        };
    }

    function makeCollectionRef(path, constraints) {
        constraints = constraints || [];
        const ref = {
            path,
            doc: (id) => makeDocRef(path, id === undefined ? genId() : String(id)),
            add: async (data) => {
                const id = genId();
                const finalData = mergeFields({}, data);
                await putRecord(path, id, finalData);
                notifyChange(path);
                return makeDocRef(path, id);
            },
            get: async () => {
                let records = await getAllInCollection(path);
                records = applyConstraints(records, constraints);
                return makeQuerySnap(path, records);
            },
            where: (field, op, value) => makeCollectionRef(path, [...constraints, { kind: "where", field, op, value }]),
            orderBy: (field, dir) => makeCollectionRef(path, [...constraints, { kind: "orderBy", field, dir: dir || "asc" }]),
            limit: (n) => makeCollectionRef(path, [...constraints, { kind: "limit", n }]),
            onSnapshot: (onNext, onError) => {
                let cancelled = false;
                const run = async () => {
                    if (cancelled) return;
                    try {
                        const snap = await ref.get();
                        onNext(snap);
                    } catch (e) { if (onError) onError(e); }
                };
                run();
                const listener = { collection: path, cb: run };
                listeners.add(listener);
                return () => { cancelled = true; listeners.delete(listener); };
            }
        };
        return ref;
    }

    function makeBatch() {
        const ops = [];
        return {
            set: (docRef, data, opts) => ops.push({ type: "set", docRef, data, opts }),
            update: (docRef, data) => ops.push({ type: "update", docRef, data }),
            delete: (docRef) => ops.push({ type: "delete", docRef }),
            commit: async () => {
                for (const op of ops) {
                    if (op.type === "set") await op.docRef.set(op.data, op.opts);
                    else if (op.type === "update") await op.docRef.update(op.data);
                    else if (op.type === "delete") await op.docRef.delete();
                }
            }
        };
    }

    function firestoreInstance() {
        return {
            collection: (path) => makeCollectionRef(path),
            batch: () => makeBatch(),
            runTransaction: async (updateFn) => {
                const pendingOps = [];
                const txObj = {
                    get: (docRef) => docRef.get(),
                    set: (docRef, data, opts) => pendingOps.push({ type: "set", docRef, data, opts }),
                    update: (docRef, data) => pendingOps.push({ type: "update", docRef, data }),
                    delete: (docRef) => pendingOps.push({ type: "delete", docRef })
                };
                const result = await updateFn(txObj);
                for (const op of pendingOps) {
                    if (op.type === "set") await op.docRef.set(op.data, op.opts);
                    else if (op.type === "update") await op.docRef.update(op.data);
                    else if (op.type === "delete") await op.docRef.delete();
                }
                return result;
            }
        };
    }
    firestoreInstance.FieldValue = {
        serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
        increment: (n) => ({ __sentinel: "increment", n }),
        delete: () => ({ __sentinel: "deleteField" })
    };

    // ---- Auth (تخزين محلي بسيط لحسابات المستخدمين اللي بينشئها الأدمن) ----
    const AUTH_COLLECTION = "_local_auth_users";
    function authInstance() {
        let currentUser = null;
        const stateListeners = [];
        return {
            createUserWithEmailAndPassword: async (email, password) => {
                const idb = await openIDB();
                const existing = await getAllInCollection(AUTH_COLLECTION);
                if (existing.some(r => r.data.email === email)) {
                    const err = new Error("البريد الإلكتروني مستخدم بالفعل");
                    err.code = "auth/email-already-in-use";
                    throw err;
                }
                const uid = genId();
                await putRecord(AUTH_COLLECTION, uid, { email, password });
                currentUser = { uid, email };
                stateListeners.forEach(cb => cb(currentUser));
                return { user: currentUser };
            },
            signInWithEmailAndPassword: async (email, password) => {
                const existing = await getAllInCollection(AUTH_COLLECTION);
                const match = existing.find(r => r.data.email === email && r.data.password === password);
                if (!match) {
                    const err = new Error("بيانات الدخول غير صحيحة");
                    err.code = "auth/wrong-password";
                    throw err;
                }
                currentUser = { uid: match.id, email };
                stateListeners.forEach(cb => cb(currentUser));
                return { user: currentUser };
            },
            signOut: async () => { currentUser = null; stateListeners.forEach(cb => cb(null)); },
            onAuthStateChanged: (cb) => { stateListeners.push(cb); cb(currentUser); },
            get currentUser() { return currentUser; }
        };
    }

    window.firebase = {
        initializeApp: (config) => ({ __app: true, config }),
        firestore: firestoreInstance,
        auth: authInstance
    };
})();
