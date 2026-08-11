const CACHE_NAME = "elzaiady-cache-v8";

// 🔥 قائمة شاملة ومحدّثة بكافة صفحات وملفات المشروع الحقيقية
const STATIC_FILES = [
  "./",
  "./index.html",
  "./index1.html",
  "./index2.html",
  "./index3.html",
  "./offline.html",
  "./manifest.json",
  "./icon-192.jpg",
  "./icon-512.png",

  "./add-customer.html",
  "./add-product.html",
  "./add-shortages.html",
  "./add-supplier.html",
  "./admin.html",
  "./all-orders.html",
  "./all-receipts.html",
  "./allfile.html",
  "./balances.html",
  "./banknote.html",
  "./cash-flow.html",
  "./client-vouchers.html",
  "./client_menu.html",
  "./customer-details.html",
  "./customer-installments.html",
  "./customer-list.html",
  "./customer-orders.html",
  "./customer-payment.html",
  "./customer-portal.html",
  "./customer-statement.html",
  "./customer-transactions-log.html",
  "./customers-trash.html",
  "./dashboard.html",
  "./edit-customer.html",
  "./edit-supplier.html",
  "./editablecells.html",
  "./expenses.html",
  "./general-ledger.html",
  "./generate-links.html",
  "./initial-balances.html",
  "./inventory-list.html",
  "./inventory-menu.html",
  "./inventory.html",
  "./invoice-details.html",
  "./low_stock1.html",
  "./mabiat-menu.html",
  "./makhzan.html",
  "./mkhazen.html",
  "./new-order.html",
  "./new-purchase-invoice.html",
  "./orders-home.html",
  "./overdue-debts.html",
  "./price-search.html",
  "./product-details.html",
  "./profit.html",
  "./purchase-invoices-list.html",
  "./purchase-mgmt.html",
  "./purchase-orders-list.html",
  "./purchase-return.html",
  "./quotation-history.html",
  "./quotation.html",
  "./remaining-amounts.html",
  "./reports.html",
  "./reports1.html",
  "./reports2.html",
  "./reports3.html",
  "./required-items-summary.html",
  "./returns-list.html",
  "./sales-history.html",
  "./sales-invoice.html",
  "./sales-return.html",
  "./sales-returns-history.html",
  "./sales_transactions.html",
  "./sandok.html",
  "./sandok1.html",
  "./settings.html",
  "./setup-accounting.html",
  "./supplier-debts.html",
  "./supplier-details.html",
  "./supplier-installments.html",
  "./supplier-list.html",
  "./supplier-management.html",
  "./supplier-opening-balance.html",
  "./supplier-payment.html",
  "./supplier-statement.html",
  "./tacnefat.html",
  "./top-customers.html",
  "./transactions-log.html",
  "./trash.html",
  "./trashi.html",
  "./trashl.html",
  "./update-inventory.html",
  "./upload-supplier.html",
  "./upload_customers.html",
  "./upload_excel.html",
  "./vouchers-hub.html",
  "./vouchers.html",
  "./whatsapp-campaigns.html",

  "./cloud-backup.js",
  "./delete-all-customers.js",
  "./firebase-compat-shim.js",
  "./firebase-shim.js",
  "./seed-users.js",
  "./supabase-config.js",

  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css",
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
];

/* ===========================
   INSTALL (تثبيت الملفات)
=========================== */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // نستخدم إضافة كل ملف بشكل منفصل بدل addAll
      // عشان لو ملف واحد فشل (مثلاً غير موجود) مايوقفش تخزين باقي الملفات
      return Promise.all(
        STATIC_FILES.map(url =>
          cache.add(url).catch(err => console.warn("تعذر تخزين:", url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

/* ===========================
   ACTIVATE (تحديث الإصدارات)
=========================== */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

/* ===========================
   FETCH (استراتيجية التشغيل أوفلاين)
=========================== */
self.addEventListener("fetch", event => {
  const request = event.request;

  // 1. استثناء طلبات قواعد البيانات (Firebase/Supabase) للسماح لها بالعمل أوفلاين ذاتياً
  if (request.url.includes("firestore.googleapis.com") || request.url.includes("firebase") || request.url.includes("supabase")) {
    return;
  }

  // 2. استراتيجية تحديث صفحات الـ HTML أولاً، مع الرجوع لصفحة "بدون إنترنت" عند الفشل الكامل
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          return response;
        })
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match("./offline.html"))
        )
    );
    return;
  }

  // 3. استراتيجية الكاش أولاً للملفات الثابتة (CSS/JS/Images)
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      return cachedResponse || fetch(request).then(networkResponse => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
        return networkResponse;
      });
    })
  );
});
