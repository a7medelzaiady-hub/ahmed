const CACHE_NAME = "elzaiady-cache-v10";

// ملفات الصفحات الأساسية والحارس: تُجلب من الشبكة أولاً دائماً (Network First)
// حتى لا تعلق نسخة قديمة منها في الكاش وتسبب حلقة إعادة التوجيه
const NETWORK_FIRST_FILES = [
  "auth-guard.js",
  "index.html",
  "index1.html",
  "sw.js",
  "manifest.json"
];

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
  "./allfiles.html",
  "./allfiles1.html",
  "./archive-images.html",
  "./backup.html",
  "./balances.html",
  "./banknote.html",
  "./cash-flow.html",
  "./cash-register.html",
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
  "./inventory2.html",
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
  "./profit-details.html",
  "./profit.html",
  "./profits.html",
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
  "./salaries-advances.html",
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
  "./user-monitor.html",
  "./users-permissions.html",
  "./vouchers-hub.html",
  "./vouchers.html",
  "./whatsapp-campaigns.html",

  "./auth-guard.js",
  "./cloud-backup.js",
  "./delete-all-customers.js",
  "./firebase-compat-shim.js",
  "./firebase-shim.js",
  "./seed-users.js",
  "./supabase-config.js",

  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css",
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",

  // مكتبات Firebase (ES modules) لتعمل الصفحات أوفلاين
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
];

/* ===========================
   أدوات مساعدة
=========================== */

// نخزن فقط الردود السليمة، وغير المعاد توجيهها
function isCacheable(response) {
  return response && response.ok && response.status === 200 && !response.redirected;
}

// طلبات قواعد البيانات تُترك للمتصفح (Firestore يدير الأوفلاين بنفسه)
function isDatabaseRequest(url) {
  const h = url.hostname;
  return (
    h.includes("firestore.googleapis.com") ||
    h.includes("firebaseio.com") ||
    h.includes("identitytoolkit.googleapis.com") ||
    h.includes("securetoken.googleapis.com") ||
    h.includes("supabase")
  );
}

function isNetworkFirst(url) {
  if (url.origin !== self.location.origin) return false;
  return NETWORK_FIRST_FILES.some(f => url.pathname.endsWith("/" + f) || url.pathname === "/" + f) ||
         url.pathname.endsWith("/"); // الصفحة الرئيسية "/"
}

/* ===========================
   INSTALL
=========================== */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // إضافة كل ملف على حدة، فلو ملف فشل لا يتوقف الباقي
      Promise.all(
        STATIC_FILES.map(url =>
          // cache: "reload" لضمان جلب النسخة الحديثة من السيرفر وليس من كاش المتصفح
          cache.add(new Request(url, { cache: "reload" })).catch(err =>
            console.warn("تعذر تخزين:", url, err)
          )
        )
      )
    )
  );
  self.skipWaiting();
});

/* ===========================
   ACTIVATE (حذف الكاش القديم)
=========================== */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys.map(key => (key !== CACHE_NAME ? caches.delete(key) : undefined))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ===========================
   FETCH
=========================== */
self.addEventListener("fetch", event => {
  const request = event.request;

  // نتعامل فقط مع طلبات GET
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 1. طلبات قواعد البيانات: لا نتدخل
  if (isDatabaseRequest(url)) return;

  // 2. الملفات الحرجة (الحارس + صفحة الدخول + الرئيسية): الشبكة أولاً
  //    الكاش يُستخدم فقط عند انقطاع الإنترنت
  if (isNetworkFirst(url)) {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          if (isCacheable(networkResponse)) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() =>
          caches.match(request).then(cached => {
            if (cached) return cached;
            if (request.headers.get("accept")?.includes("text/html")) {
              return caches.match("./offline.html");
            }
            return Response.error();
          })
        )
    );
    return;
  }

  // 3. باقي صفحات HTML: الكاش فوراً + تحديث في الخلفية (Stale-While-Revalidate)
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(request).then(cachedResponse => {
          const networkFetch = fetch(request)
            .then(networkResponse => {
              if (isCacheable(networkResponse)) {
                cache.put(request, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => cachedResponse || caches.match("./offline.html"));

          return cachedResponse || networkFetch;
        })
      )
    );
    return;
  }

  // 4. الملفات الثابتة (CSS/JS/صور/خطوط): الكاش أولاً
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;

      return fetch(request)
        .then(networkResponse => {
          if (isCacheable(networkResponse)) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => Response.error());
    })
  );
});
