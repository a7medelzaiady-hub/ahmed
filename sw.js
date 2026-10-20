// =====================================================================
// sw.js — Service Worker (النسخة الأوفلاين الكاملة)
// ---------------------------------------------------------------------
// - يخزّن كل صفحات البرنامج + مكتبات فايربيز + بوتستراب/خطوط/أيقونات من أول
//   تشغيل، فيشتغل بعدها من غير نت (حتى لو الصفحة مفتوحة برابط فيه ?id=...).
// - طلبات قاعدة البيانات نفسها (firestore.googleapis.com) مش بيتدخل فيها:
//   مكتبة فايربيز بتتولاها (تخزين محلي + رفع تلقائي لما النت يرجع).
// - ملفات الموقع نفسه (HTML/JS/CSS) بتتعرض من الكاش فورًا وبتتحدّث بالخلفية،
//   فأي تعديل في ملف زي shop-publish.js بيوصل في الفتحة اللي بعدها.
// =====================================================================
const CACHE_NAME = "elzaiady-cache-v15";

const LOCAL_FILES = [
  "./",
  "./account-statement.html",
  "./add-customer.html",
  "./add-product.html",
  "./add-shortages.html",
  "./add-supplier.html",
  "./admin.html",
  "./ai-image-generator.html",
  "./all-orders.html",
  "./all-receipts.html",
  "./allfile.html",
  "./allfiles.html",
  "./allfiles1.html",
  "./archive-images.html",
  "./auth-guard.js",
  "./backup.html",
  "./balances.html",
  "./banknote.html",
  "./car-audit.html",
  "./cash-flow.html",
  "./cash-register.html",
  "./cash.html",
  "./client-vouchers.html",
  "./client_menu.html",
  "./cloud-backup.js",
  "./compare-prices.html",
  "./compat-offline.js",
  "./customer-details.html",
  "./customer-installments.html",
  "./customer-list.html",
  "./customer-orders.html",
  "./customer-payment.html",
  "./customer-portal.html",
  "./customer-statement.html",
  "./customer-transactions-log.html",
  "./customers-trash.html",
  "./daily-sales-summary.html",
  "./dashboard.html",
  "./delete-all-customers.js",
  "./edit-customer.html",
  "./edit-supplier.html",
  "./editablecells.html",
  "./expenses.html",
  "./firebase-compat-shim.js",
  "./firebase-shim.js",
  "./file-backup.js",
  "./shop.html",
  "./shop-admin.html",
  "./shop-menu.html",
  "./shop-card.js",
  "./shop-publish.js",
  "./firestore-offline.js",
  "./general-ledger.html",
  "./generate-links.html",
  "./icon-192.jpg",
  "./icon-512.png",
  "./index.html",
  "./index1.html",
  "./index2.html",
  "./index3.html",
  "./initial-balances.html",
  "./inventory-list.html",
  "./inventory-menu.html",
  "./inventory.html",
  "./inventory2.html",
  "./invoice-details.html",
  "./item-car-report.html",
  "./low_stock1.html",
  "./mabiat-menu.html",
  "./makhzan.html",
  "./manifest.json",
  "./mkhazen.html",
  "./new-order.html",
  "./new-purchase-invoice.html",
  "./offline.html",
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
  "./seed-users.js",
  "./settings.html",
  "./setup-accounting.html",
  "./supabase-config.js",
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
  "./vodafonecash.html",
  "./vouchers-hub.html",
  "./vouchers.html",
  "./whatsapp-campaigns.html"
];

// مكتبات خارجية لازم تتخزن عشان الصفحات تشتغل أوفلاين
const CDN_FILES = [
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap",
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap",
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800&display=swap",
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap"
];

// طلبات ما يصحّش نتدخل فيها (قاعدة البيانات / الدخول / الرفع / خدمات خارجية)
const PASS_THROUGH_HOSTS = [
  "firestore.googleapis.com", "firebasestorage.googleapis.com",
  "identitytoolkit.googleapis.com", "securetoken.googleapis.com",
  "www.googleapis.com", "api.minimax.chat", "supabase.co"
];

// ---------- أدوات مساعدة ----------
async function cacheOne(cache, url) {
  try {
    const res = await fetch(url);
    if (res && (res.ok || res.type === "opaque")) { await cache.put(url, res.clone()); return res; }
  } catch (e) { console.warn("تعذر تخزين:", url); }
  return null;
}

// يقرأ ملفات الـ ES module ويخزّن أي ملفات بتستوردها (فايربيز بيستورد ملفات تانية)
async function cacheModuleGraph(cache, url, seen) {
  if (seen.has(url)) return;
  seen.add(url);
  const res = await cacheOne(cache, url);
  if (!res || res.type === "opaque") return;
  let text = "";
  try { text = await res.clone().text(); } catch (e) { return; }
  const re = /(?:from|import)\s*["']((?:https?:\/\/|\.{1,2}\/)[^"']+\.js)["']/g;
  let m;
  while ((m = re.exec(text))) {
    try { await cacheModuleGraph(cache, new URL(m[1], url).href, seen); } catch (e) { /* ignore */ }
  }
}

// يقرأ ملفات CSS ويخزّن الخطوط/الصور المرتبطة بيها (Font Awesome + Google Fonts)
async function cacheCssAssets(cache, url) {
  try {
    const res = await cache.match(url);
    if (!res) return;
    const text = await res.clone().text();
    const re = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
    let m; const urls = new Set();
    while ((m = re.exec(text))) {
      if (m[1].startsWith("data:")) continue;
      try { urls.add(new URL(m[1], url).href); } catch (e) { /* ignore */ }
    }
    await Promise.all([...urls].map(u => cacheOne(cache, u)));
  } catch (e) { /* ignore */ }
}

// ---------- INSTALL ----------
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(LOCAL_FILES.map(u => cacheOne(cache, u)));
    const seen = new Set();
    await Promise.all(CDN_FILES.map(u => /\.js$/.test(u) ? cacheModuleGraph(cache, u, seen) : cacheOne(cache, u)));
    await Promise.all(CDN_FILES.filter(u => /\.css|fonts\.googleapis/.test(u)).map(u => cacheCssAssets(cache, u)));
  })());
  self.skipWaiting();
});

// ---------- ACTIVATE ----------
// أول ما النسخة الجديدة تشتغل: امسح كل الكاش القديم (أي اسم غير الحالي) على الجهاز،
// واطلب من الصفحات المفتوحة تتحدّث. الصفحات المخفية بتتحدّث فورًا، والظاهرة بنعرض فيها
// زرار «تحديث» (عشان ما نقطعش على المستخدم وهو بيكتب فاتورة).
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const old = keys.filter(k => k !== CACHE_NAME);
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    if (old.length) {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of wins) {
        if (c.visibilityState === "hidden") { try { await c.navigate(c.url); } catch (e) { /* ignore */ } }
        else c.postMessage({ type: "SW_UPDATED" });
      }
    }
  })());
});

// السماح للصفحة بطلب مسح كل الكاش يدويًا
self.addEventListener("message", event => {
  if (event.data && event.data.type === "CLEAR_CACHES") {
    event.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
  }
});

// ---------- FETCH ----------
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (!/^https?:$/.test(url.protocol)) return;
  if (PASS_THROUGH_HOSTS.some(h => url.hostname === h || url.hostname.endsWith("." + h))) return;

  const isSameOrigin = url.origin === self.location.origin;
  const isPage = request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");

  // صفحات HTML: نعرض المخزّنة فورًا ونحدّثها بالخلفية. المطابقة بتتجاهل ?id=... عشان الصفحات
  // اللي بتفتح بمعاملات (customer-details.html?id=..) تشتغل أوفلاين.
  if (isPage && isSameOrigin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const key = url.origin + url.pathname;
      const cached = await cache.match(key) || await cache.match(request, { ignoreSearch: true });
      const network = fetch(request).then(res => {
        if (res && res.ok) cache.put(key, res.clone());
        return res;
      }).catch(() => null);
      if (cached) { event.waitUntil(network); return cached; }
      const res = await network;
      return res || (await cache.match("./offline.html")) || Response.error();
    })());
    return;
  }

  // ملفات الموقع نفسه (JS/CSS/صور/manifest): نعرض المخزّن فورًا ونحدّثه بالخلفية،
  // عشان أي تعديل في ملف زي shop-publish.js يوصل من غير ما نغيّر رقم الكاش.
  if (isSameOrigin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request) || await cache.match(request, { ignoreSearch: true });
      const network = fetch(request).then(res => {
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => null);
      if (cached) { event.waitUntil(network); return cached; }
      const res = await network;
      return res || Response.error();
    })());
    return;
  }

  // الملفات الخارجية (فايربيز/بوتستراب/خطوط/أيقونات): الكاش أولًا، ولو مش موجود نجيبه ونخزّنه
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const res = await fetch(request);
      if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
      return res;
    } catch (e) {
      const fallback = await cache.match(request, { ignoreSearch: true });
      if (fallback) return fallback;
      throw e;
    }
  })());
});
