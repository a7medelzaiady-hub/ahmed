/**
 * Unified, read-only stock calculation for the warehouse and truck-loading pages.
 * Every output amount is in individual pieces/jerrycans, not cartons.
 * Do not write the calculated balance into Firebase: it is derived from movements.
 */

export function normalizeStockName(name) {
    return String(name || '').trim()
        .replace(/[\u064B-\u0652]/g, '')
        .replace(/[أإآا]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .toLowerCase();
}

function positiveFactor(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
    }
    return 1;
}

function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function isCartonUnit(unit, flag) {
    if (flag === true) return true;
    const value = String(unit || '').trim().toLowerCase();
    return value === 'box' || value === 'carton' || value === 'كرتونة' || value === 'كرتونه';
}

function isInactiveMovement(movement) {
    const state = String(movement.status || '').toLowerCase();
    return movement.isDeleted === true ||
        state === 'deleted' || state === 'cancelled' || state === 'canceled';
}

export function calculateStockBalances({
    inventoryItems = [],
    salesInvoices = [],
    supplierTransactions = [],
    openingTransactions = [],
    trace = false
} = {}) {
    // trace=true: كل صف يرجع معه movements (تفاصيل كل حركة أثرت على الرصيد) لصفحة التشخيص stock-debug.html
    const moves = new Map();
    const note = (id, m) => { if (!trace) return; if (!moves.has(id)) moves.set(id, []); moves.get(id).push(m); };
    const factors = new Map();
    const names = new Map();
    const inventory = inventoryItems.filter(item => item && item.id && !item.isDeleted);

    for (const item of inventory) {
        factors.set(item.id, positiveFactor(item.unitFactor, item.pcsPerCarton, item.factor));
        if (item.name) names.set(normalizeStockName(item.name), item.id);
    }

    function productIdForItem(item) {
        for (const id of [item.stockId, item.productId, item.id]) {
            if (id && factors.has(id)) return id;
        }
        const name = item.name || item.productName || item.itemName || item.item_name;
        return names.get(normalizeStockName(name)) || null;
    }

    const opening = new Map();
    const sales = new Map();
    const purchases = new Map();

    for (const tr of openingTransactions) {
        if (!tr || !tr.productId) continue;
        opening.set(tr.productId, (opening.get(tr.productId) || 0) + numberOrZero(tr.quantityPcs));
        note(tr.productId, { kind: 'opening', ref: tr.id || '', date: tr.date || '', rawQty: numberOrZero(tr.quantityPcs), unit: 'قطعة', factor: 1, pcs: numberOrZero(tr.quantityPcs), delta: numberOrZero(tr.quantityPcs), flags: [] });
    }

    for (const invoice of salesInvoices) {
        if (!invoice || isInactiveMovement(invoice) || !Array.isArray(invoice.items)) continue;
        const invoiceIsReturn = invoice.type === 'return' || invoice.isReturn === true;
        for (const item of invoice.items) {
            if (!item) continue;
            const id = productIdForItem(item);
            if (!id) continue;
            const factor = positiveFactor(item.unitFactor, item.factor, factors.get(id));
            const qty = numberOrZero(item.qty);
            const pcs = isCartonUnit(item.unit || item.unitName, item.isCarton) ? qty * factor : qty;
            const delta = (invoiceIsReturn || item.isReturn === true) ? -Math.abs(pcs) : pcs;
            sales.set(id, (sales.get(id) || 0) + delta);
            note(id, { kind: (invoiceIsReturn || item.isReturn === true) ? 'sale-return' : 'sale', ref: invoice.id || invoice.invoiceNumber || '', date: invoice.date || invoice.dateStr || '', party: invoice.customerName || invoice.clientName || '', rawQty: qty, unit: item.unit || item.unitName || '', isCartonFlag: item.isCarton === true, factor, pcs, delta: -delta, flags: [!(item.unit || item.unitName) && item.isCarton !== true ? 'بدون وحدة (اعتُبرت قطع)' : ''].filter(Boolean) });
        }
    }

    for (const transaction of supplierTransactions) {
        if (!transaction || isInactiveMovement(transaction) || !Array.isArray(transaction.items)) continue;
        for (const item of transaction.items) {
            if (!item) continue;
            const id = productIdForItem(item);
            if (!id) continue;
            const factor = positiveFactor(item.unitFactor, item.factor, factors.get(id));
            const isReturn = numberOrZero(item.returnQty) > 0 || item.isReturn === true;
            const qty = numberOrZero(isReturn ? (item.returnQty || item.qty) : item.qty);
            const pcs = isCartonUnit(item.unitName || item.unit, item.isCarton) ? qty * factor : qty;
            purchases.set(id, (purchases.get(id) || 0) + (isReturn ? -Math.abs(pcs) : pcs));
            note(id, { kind: isReturn ? 'purchase-return' : 'purchase', ref: transaction.id || '', date: transaction.date || transaction.dateStr || '', party: transaction.supplierName || '', rawQty: qty, unit: item.unitName || item.unit || '', isCartonFlag: item.isCarton === true, factor, pcs, delta: isReturn ? -Math.abs(pcs) : pcs, flags: [!(item.unitName || item.unit) && item.isCarton !== true ? 'بدون وحدة (اعتُبرت قطع)' : ''].filter(Boolean) });
        }
    }

    return inventory.map(item => {
        const factor = factors.get(item.id) || 1;
        let openingPcs = 0;
        if (item.openingTotalPcs != null) {
            openingPcs = numberOrZero(item.openingTotalPcs);
        } else if (item.openingQty != null) {
            openingPcs = Math.round(numberOrZero(item.openingQty) * factor);
        } else {
            openingPcs = opening.get(item.id) || 0;
        }
        const salesPcs = sales.get(item.id) || 0;
        const purchasesPcs = purchases.get(item.id) || 0;
        const totalPcs = openingPcs + purchasesPcs - salesPcs;
        const row = { ...item, capacity: factor, openingPcs, purchasesPcs, salesPcs, totalPcs };
        if (trace) {
            row.movements = moves.get(item.id) || [];
            row.openingSource = item.openingTotalPcs != null ? 'openingTotalPcs' : (item.openingQty != null ? 'openingQty×factor' : 'inventory_transactions');
        }
        return row;
    });
}
