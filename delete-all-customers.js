import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, getDocs, doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAS0NNcZ1o-TL2nWCB7p0941jR0bo-MNls",
  authDomain: "ahmedelzaiady.firebaseapp.com",
  projectId: "ahmedelzaiady",
  storageBucket: "ahmedelzaiady.firebasestorage.app",
  messagingSenderId: "300306825071",
  appId: "1:300306825071:web:0426ddde56280fa090329a"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

window.deleteAllCustomers = async () => {
    console.log("بدأ جلب البيانات للحذف...");
    
    // جلب مستندات العملاء
    const snap = await getDocs(collection(db, "customers"));
    console.log("إجمالي عدد العملاء المراد حذفهم:", snap.size);

    if (snap.empty) {
        console.log("لا يوجد عملاء لحذفهم.");
        return;
    }

    // إنشاء Batch جديد
    const batch = writeBatch(db);

    // إضافة عمليات الحذف إلى الـ Batch
    snap.docs.forEach((d) => {
        batch.delete(doc(db, "customers", d.id));
    });

    // تنفيذ الحذف دفعة واحدة
    await batch.commit();

    console.log("تم حذف كل العملاء بنجاح وبسرعة.");
};
