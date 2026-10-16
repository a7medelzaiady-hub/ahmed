/*!
 * auth-guard.js — حارس الدخول الموحد لكل صفحات النظام
 * ------------------------------------------------------
 * الغرض:
 *  1) منع فتح أي صفحة داخلية مباشرة (رابط خارجي / اختصار / تبويب محفوظ)
 *     بدون جلسة دخول صالحة — يتم التحويل فوراً لصفحة index.html.
 *  2) إبطال الجلسة تلقائياً إذا مرّ أكثر من يوم كامل بدون استخدام،
 *     حتى لو كانت الصفحة محفوظة (Cache) على الهاتف.
 *  3) الاعتماد على localStorage (يبقى بعد إغلاق التطبيق) بدل
 *     sessionStorage فقط، حتى يعمل الفحص أوفلاين دون أي طلب شبكة،
 *     ويُبقي الجلسة شغالة بسلاسة أثناء الاستخدام العادي كل يوم.
 *
 * ملاحظة: هذا السكربت لازم يكون أول شيء يُحمَّل داخل <head>،
 * بدون async أو defer، حتى يوقف عرض الصفحة قبل ظهور أي بيانات
 * حساسة في حال كانت الجلسة غير صالحة.
 */
(function () {
  "use strict";

  var DAY_MS = 24 * 60 * 60 * 1000; // مدة صلاحية الجلسة: يوم واحد بدون استخدام
  var LOGIN_PAGE = "index.html";

  var currentPage = (location.pathname.split("/").pop() || "").toLowerCase();
  if (currentPage === "" || currentPage === LOGIN_PAGE) return; // صفحة الدخول نفسها لا تُفحص

  function clearAll() {
    try {
      ["authGuard_token", "authGuard_time", "authGuard_user", "authGuard_role", "authGuard_userId"]
        .forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
  }

  function redirectToLogin() {
    clearAll();
    // location.replace حتى لا تُحفظ الصفحة المحمية في تاريخ المتصفح (زر رجوع)
    location.replace(LOGIN_PAGE);
  }

  var token, ts;
  try {
    token = localStorage.getItem("authGuard_token");
    ts = parseInt(localStorage.getItem("authGuard_time") || "0", 10);
  } catch (e) {
    // لو التخزين المحلي غير متاح (وضع تصفح خاص مثلاً) نعتبر الجلسة غير موثوقة
    redirectToLogin();
    return;
  }

  var now = Date.now();

  // لا توجد جلسة محفوظة إطلاقاً (فتح مباشر برابط خارجي على جهاز/متصفح جديد)
  if (!token) {
    redirectToLogin();
    return;
  }

  // مرّ أكثر من يوم كامل منذ آخر استخدام فعلي للنظام
  if (!ts || (now - ts) > DAY_MS) {
    redirectToLogin();
    return;
  }

  // ✅ الجلسة صالحة: نجدد وقت آخر نشاط (تمديد منزلق) ونزامن sessionStorage
  // حتى تستمر بقية أكواد الصفحات (التي تعتمد على sessionStorage) في العمل
  // بشكل طبيعي حتى بعد إغلاق التطبيق وإعادة فتحه خلال نفس اليوم.
  try {
    localStorage.setItem("authGuard_time", String(now));

    var user = localStorage.getItem("authGuard_user") || "";
    var role = localStorage.getItem("authGuard_role") || "restricted";
    var userId = localStorage.getItem("authGuard_userId") || "";

    if (!sessionStorage.getItem("authToken")) sessionStorage.setItem("authToken", token);
    sessionStorage.setItem("isLoggedIn", "true");
    if (user) {
      sessionStorage.setItem("username", user);
      sessionStorage.setItem("user_name", user);
    }
    if (role) sessionStorage.setItem("role", role);
    if (userId) sessionStorage.setItem("userId", userId);
  } catch (e) {}
})();
