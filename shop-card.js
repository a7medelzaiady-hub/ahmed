// =====================================================================
// shop-card.js — بيضيف كارت «المتجر» للشاشة الرئيسية (index1.html) وفي القائمة الجانبية.
// الكارت للأدمن فقط (data-perm="admin_only") فنظام الصلاحيات في الصفحة بيخفيه عن الباقي.
// استخدمه بسطر واحد قبل </body> في index1.html:
//     <script src="shop-card.js"></script>
// =====================================================================
(function () {
    function inject() {
        if (document.getElementById("cardShop")) return;

        // 1) كارت في الشاشة الرئيسية (قسم المبيعات والعملاء)
        var grid = document.getElementById("gridSalesOps") || document.querySelector(".card-grid");
        if (grid) {
            var a = document.createElement("a");
            a.href = "shop-menu.html";
            a.className = "grid-card";
            a.id = "cardShop";
            a.setAttribute("data-perm", "admin_only");
            a.innerHTML = '<div class="card-icon-wrap icon-violet"><i class="fa-solid fa-store"></i></div><span class="card-label">المتجر</span>';
            var ref = document.getElementById("cardAiImages") || document.getElementById("cardSuppliers");
            if (ref && ref.parentNode === grid) grid.insertBefore(a, ref); else grid.appendChild(a);
        }

        // 2) رابط في القائمة الجانبية
        var drawer = document.querySelector(".drawer-body");
        if (drawer && !drawer.querySelector('a[href="shop-menu.html"]')) {
            var d = document.createElement("a");
            d.href = "shop-menu.html";
            d.className = "drawer-link";
            d.setAttribute("data-perm", "admin_only");
            d.innerHTML = '<i class="fa-solid fa-store"></i> المتجر';
            var cm = drawer.querySelector('a[href="client_menu.html"]');
            if (cm) cm.parentNode.insertBefore(d, cm.nextSibling); else drawer.insertBefore(d, drawer.firstChild);
        }
    }
    // السكربت في آخر الصفحة والعناصر موجودة بالفعل: ننفّذ فورًا (قبل فحص الصلاحيات)، ومرة تانية احتياطي
    inject();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
})();
