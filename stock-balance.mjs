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
    openingTransactions = []
} = {}) {
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
        return { ...item, capacity: factor, openingPcs, purchasesPcs, salesPcs, totalPcs };
    });
}
