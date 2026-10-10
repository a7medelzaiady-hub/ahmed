// =====================================================================
// cloud-backup.js
// -----------------------------------------------------------------------
// النسخ الاحتياطي اليدوي على Firebase (اختياري).
// البرنامج شغال بالكامل محليًا بدون هذا الملف؛ هو بيتفعّل بس لما
// المستخدم يدوس زرار "نسخ احتياطي" أو "استرجاع من فايربيز"، وساعتها
// محتاج إنترنت لحظة الضغط فقط.
// =====================================================================

import { initializeApp } from "./firebase-shim.js";
import {
    getFirestore, doc, setDoc, getDocs, collection
} from "./firebase-shim.js";

import { __exportAllLocalData, __importAllLocalData } from "./firebase-shim.js";

// نفس بيانات مشروع الفايربيز الأصلي المستخدم في التطبيق
const firebaseConfig = {
    apiKey: "AIzaSyAS0NNcZy0t-LN2wCB7p0941jR0bo-MNls",
    authDomain: "ahmedelzaiady.firebaseapp.com",
    projectId: "ahmedelzaiady",
    storageBucket: "ahmedelzaiady.firebasestorage.app",
    messagingSenderId: "300306825071",
    appId: "1:300306825071:web:0426ddde56280fa090329a",
    measurementId: "G-WE04GK5XZZ"
};

// كل أسماء الكوليكشنز المستخدمة في التطبيق (لأغراض الاسترجاع من فايربيز)
export const KNOWN_COLLECTIONS = [
    "customers", "suppliers", "invoices", "invoice", "orders", "sales",
    "purchases", "purchase_orders", "returns", "payments", "expenses",
    "transactions", "supplierTransactions", "supplier_transactions",
    "supplierInvoices", "installments", "inventory", "products",
    "categories", "cash_logs", "archived_profits", "shortages",
    "quotations", "users", "settings"
];

let _cloudApp = null;
let _cloudDb = null;
function getCloudDb() {
    if (!_cloudDb) {
        _cloudApp = initializeApp(firebaseConfig);
        _cloudDb = getFirestore(_cloudApp);
    }
    return _cloudDb;
}

const LAST_BACKUP_KEY = "elzaiady_last_backup_time";
const LAST_RESTORE_KEY = "elzaiady_last_restore_time";

export function getLastBackupTime() { return localStorage.getItem(LAST_BACKUP_KEY); }
export function getLastRestoreTime() { return localStorage.getItem(LAST_RESTORE_KEY); }

/**
 * يرفع كل البيانات المحلية (اللي جوه الموبايل) على Firebase.
 * onProgress(done, total) اختياري لعرض شريط تقدم.
 */
export async function backupToFirebase(onProgress) {
    if (!navigator.onLine) throw new Error("لازم تكون متصل بالإنترنت عشان تعمل نسخة احتياطية.");

    const localData = await __exportAllLocalData();
    const db = getCloudDb();

    let total = 0;
    Object.values(localData).forEach(col => { total += Object.keys(col).length; });
    let done = 0;

    for (const collectionPath of Object.keys(localData)) {
        for (const id of Object.keys(localData[collectionPath])) {
            await setDoc(doc(db, collectionPath, id), localData[collectionPath][id]);
            done++;
            if (onProgress) onProgress(done, total);
        }
    }

    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
    return { done, total };
}

/**
 * يسحب كل البيانات من Firebase ويخزّنها محليًا (بيحل محل البيانات المحلية الحالية).
 * onProgress(collectionName, index, totalCollections) اختياري.
 */
export async function restoreFromFirebase(onProgress) {
    if (!navigator.onLine) throw new Error("لازم تكون متصل بالإنترنت عشان تسترجع النسخة الاحتياطية.");

    const db = getCloudDb();
    const grouped = {};
    let idx = 0;

    for (const c of KNOWN_COLLECTIONS) {
        idx++;
        if (onProgress) onProgress(c, idx, KNOWN_COLLECTIONS.length);
        try {
            const snap = await getDocs(collection(db, c));
            if (!snap.empty) {
                grouped[c] = {};
                snap.forEach(d => { grouped[c][d.id] = d.data(); });
            }
        } catch (e) {
            // الكوليكشن ممكن يكون مش موجود على فايربيز، تجاهل وكمل
        }
    }

    await __importAllLocalData(grouped, { clearFirst: true });
    localStorage.setItem(LAST_RESTORE_KEY, new Date().toISOString());
    return grouped;
}
