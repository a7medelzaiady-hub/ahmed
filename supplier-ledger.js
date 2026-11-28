/*
 * supplier-ledger.js
 * طريقة حساب واحدة لحساب المورد، تستخدمها كل صفحات الموردين والمشتريات،
 * ومطابقة لقيود النظام المحاسبي (حساب 2101 في accounting.html).
 *
 * الرصيد موجب = علينا للمورد، سالب = لنا عند المورد.
 *   الرصيد = الافتتاحي
 *          + مجموع فواتير الشراء (الصافي بعد أصناف المرتجع داخل الفاتورة)
 *          − المسدد داخل الفاتورة (كاش + محفظة)
 *          − مرتجعات الشراء
 *          − سندات الصرف المستقلة للمورد (سداد)
 *          + سندات القبض المستقلة من المورد
 * - السندات المرتبطة بفاتورة (invoiceId) نسخة مرآة للمسدد داخل الفاتورة، فلا تُحسب مرتين.
 * - المحذوف (isDeleted / deleted / isCancelled / status=deleted) لا يُحسب.
 * - الربط بالمورد بالمعرّف فقط: supplierId في الفواتير، و partyId أو supplierId في السندات.
 */
(function (root) {
  'use strict';

  var PURCHASE_TYPES = ['شراء', 'فاتورة شراء'];
  var RETURN_TYPES = ['مرتجع شراء', 'مرتجع'];

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function r2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
  function gone(d) { return !!(d && (d.isDeleted || d.deleted || d.isCancelled || d.status === 'deleted')); }

  function parseDateMs(s) {
    if (!s) return 0;
    if (typeof s.toMillis === 'function') return s.toMillis();
    if (s.seconds) return s.seconds * 1000;
    try {
      var c = String(s).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); });
      var m = c.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
      if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
      m = c.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
      if (m) return new Date(+m[3], +m[2] - 1, +m[1]).getTime();
      var t = new Date(c).getTime();
      return isNaN(t) ? 0 : t;
    } catch (e) { return 0; }
  }

  // وقت الحركة: الأدق أولاً (timestamp ثم createdAt ثم التاريخ المكتوب)
  function timeOf(d) {
    if (!d) return 0;
    return parseDateMs(d.timestamp) || parseDateMs(d.createdAt) || parseDateMs(d.date) || parseDateMs(d.time) || 0;
  }

  function firstNonZero() {
    for (var i = 0; i < arguments.length; i++) { var n = num(arguments[i]); if (n) return n; }
    return 0;
  }

  // إجمالي الفاتورة (موقّع: قد يكون سالباً لو كلها أصناف مرتجعة)
  function invoiceTotal(d) { return firstNonZero(d.total, d.grossTotal, d.amount); }

  // المسدد داخل الفاتورة: كاش + محفظة، وإلا totalPaid ثم paid (نفس قاعدة النظام المحاسبي)
  function invoicePaid(d) {
    var cash = num(d.cashPaid), wallet = num(d.walletPaid);
    if (cash || wallet) return cash + wallet;
    return firstNonZero(d.totalPaid, d.paid);
  }

  function invoiceKind(d) {
    var t = d && d.type;
    if (!t || PURCHASE_TYPES.indexOf(t) >= 0) return 'purchase';
    if (RETURN_TYPES.indexOf(t) >= 0) return 'return';
    return 'other';
  }

  // سند مستقل للمورد؟ يرجع 'payment' | 'receipt' | null
  function voucherKind(v) {
    if (!v || gone(v)) return null;
    if (v.isInvoicePayment || v.invoiceId || v.supplierTransactionId) return null; // مرآة لمدفوعات فاتورة
    if (v.expenseId || v.isExpense || v.type === 'مصروف' || v.category) return null;
    if (v.type === 'قبض') return 'receipt';
    if (v.type === 'صرف' || v.type === 'سداد') return 'payment';
    return null;
  }

  function belongsInvoice(d, supId) { return !!supId && d.supplierId === supId; }
  function belongsVoucher(v, supId) { return !!supId && (v.partyId === supId || v.supplierId === supId); }

  function openingOf(supplier) {
    return num(supplier && supplier.openingBalance) || num(supplier && supplier.initialBalance) || 0;
  }

  // يبني دفتر مورد واحد من قوائم خام (الفلترة بالمعرّف تتم هنا)
  function buildLedger(supplier, invoices, vouchers) {
    var id = supplier && supplier.id;
    var opening = openingOf(supplier);
    var events = [];
    var seq = 0;
    var seenVouchers = {};

    (invoices || []).forEach(function (d) {
      if (!belongsInvoice(d, id) || gone(d)) return;
      var kind = invoiceKind(d);
      if (kind === 'other') return;
      var total = invoiceTotal(d);
      var paid = kind === 'purchase' ? invoicePaid(d) : 0;
      if (!total && !paid) return;
      events.push({
        id: d.id, kind: kind, src: d, timeMs: timeOf(d), seq: seq++, date: d.date || d.time || '',
        total: total, paid: paid, cash: num(d.cashPaid), wallet: num(d.walletPaid),
        effect: kind === 'purchase' ? total - paid : -total
      });
    });

    (vouchers || []).forEach(function (v) {
      if (!belongsVoucher(v, id)) return;
      if (v.id) { if (seenVouchers[v.id]) return; seenVouchers[v.id] = true; }
      var kind = voucherKind(v);
      if (!kind) return;
      var amt = Math.abs(firstNonZero(v.amount, v.total));
      if (!amt) return;
      events.push({
        id: v.id, kind: kind, src: v, timeMs: timeOf(v), seq: seq++, date: v.date || v.time || '',
        total: amt, paid: 0, cash: 0, wallet: 0,
        effect: kind === 'payment' ? -amt : amt
      });
    });

    events.sort(function (a, b) { return a.timeMs - b.timeMs || a.seq - b.seq; });

    var running = opening;
    var totals = { purchases: 0, returns: 0, paidInInvoices: 0, payments: 0, receipts: 0 };
    events.forEach(function (e) {
      e.before = running;
      running += e.effect;
      e.after = running;
      if (e.kind === 'purchase') { totals.purchases += e.total; totals.paidInInvoices += e.paid; }
      else if (e.kind === 'return') totals.returns += e.total;
      else if (e.kind === 'payment') totals.payments += e.total;
      else if (e.kind === 'receipt') totals.receipts += e.total;
    });

    return { supplierId: id, opening: opening, events: events, balance: running, totals: totals };
  }

  // دفاتر كل الموردين دفعة واحدة (بدون استعلامات لكل مورد)
  function buildAllLedgers(suppliers, invoices, vouchers) {
    var invBy = {}, vouBy = {};
    (invoices || []).forEach(function (d) { if (d.supplierId) (invBy[d.supplierId] = invBy[d.supplierId] || []).push(d); });
    (vouchers || []).forEach(function (v) {
      if (v.partyId) (vouBy[v.partyId] = vouBy[v.partyId] || []).push(v);
      if (v.supplierId && v.supplierId !== v.partyId) (vouBy[v.supplierId] = vouBy[v.supplierId] || []).push(v);
    });
    var out = {};
    (suppliers || []).forEach(function (s) { out[s.id] = buildLedger(s, invBy[s.id] || [], vouBy[s.id] || []); });
    return out;
  }

  // الرصيد قبل حركة معيّنة (بترتيب الدفتر، فلا يتأثر بتساوي الأوقات)
  function balanceBefore(ledger, eventId) {
    for (var i = 0; i < ledger.events.length; i++) if (ledger.events[i].id === eventId) return ledger.events[i].before;
    return ledger.balance;
  }

  // رصيد المورد بعد استبعاد فاتورة (لشاشة إنشاء/تعديل الفاتورة)
  function balanceExcluding(supplier, invoices, vouchers, excludeInvoiceId) {
    return buildLedger(supplier, (invoices || []).filter(function (d) { return d.id !== excludeInvoiceId; }), vouchers).balance;
  }

  // إجماليات سجل المشتريات (مقيّدة بالموردين المعروفين إن أُعطيت قائمتهم)
  function purchaseTotals(ledgers) {
    var t = { purchases: 0, returns: 0, paid: 0 };
    Object.keys(ledgers).forEach(function (k) {
      var l = ledgers[k].totals;
      t.purchases += l.purchases; t.returns += l.returns;
      t.paid += l.paidInInvoices + l.payments - l.receipts;
    });
    t.net = t.purchases - t.returns;
    t.remaining = t.net - t.paid;
    return t;
  }

  function statusOf(balance) {
    if (balance > 0.1) return 'owed';      // علينا
    if (balance < -0.1) return 'credit';   // لنا
    return 'clear';
  }

  function chunk(arr, n) { var out = []; for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

  // جلب البيانات اللازمة بأقل قراءات: api = { collection, getDocs, query, where } من Firestore (modular)
  //   opts.ids: معرّفات الموردين المطلوبين | opts.allInvoices: جلب كل فواتير الشراء (لسجل المشتريات)
  async function loadSupplierDocs(api, db, opts) {
    var ids = (opts && opts.ids) || [];
    var toList = function (snap) { var a = []; snap.forEach(function (d) { a.push(Object.assign({ id: d.id }, d.data())); }); return a; };
    var jobs = [];
    var invoices = [];
    if (opts && opts.allInvoices) {
      jobs.push(api.getDocs(api.collection(db, 'supplier_transactions')).then(function (s) { invoices = toList(s); }));
    }
    var vouchers = {};
    var addV = function (s) { toList(s).forEach(function (v) { vouchers[v.id] = v; }); };
    var invExtra = {};
    chunk(ids, 30).forEach(function (part) {
      jobs.push(api.getDocs(api.query(api.collection(db, 'transactions'), api.where('partyId', 'in', part))).then(addV));
      jobs.push(api.getDocs(api.query(api.collection(db, 'transactions'), api.where('supplierId', 'in', part))).then(addV));
      if (!(opts && opts.allInvoices)) {
        jobs.push(api.getDocs(api.query(api.collection(db, 'supplier_transactions'), api.where('supplierId', 'in', part)))
          .then(function (s) { toList(s).forEach(function (d) { invExtra[d.id] = d; }); }));
      }
    });
    await Promise.all(jobs);
    if (!(opts && opts.allInvoices)) invoices = Object.keys(invExtra).map(function (k) { return invExtra[k]; });
    return { invoices: invoices, vouchers: Object.keys(vouchers).map(function (k) { return vouchers[k]; }) };
  }

  var api = {
    num: num, r2: r2, gone: gone, timeOf: timeOf, parseDateMs: parseDateMs,
    invoiceTotal: invoiceTotal, invoicePaid: invoicePaid, invoiceKind: invoiceKind, voucherKind: voucherKind, openingOf: openingOf,
    buildLedger: buildLedger, buildAllLedgers: buildAllLedgers, balanceBefore: balanceBefore, balanceExcluding: balanceExcluding,
    purchaseTotals: purchaseTotals, statusOf: statusOf, loadSupplierDocs: loadSupplierDocs
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SupplierLedger = api;
})(typeof window !== 'undefined' ? window : globalThis);
