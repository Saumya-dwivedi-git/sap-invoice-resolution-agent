const {
    getSupplierInvoices,
    getSupplierInvoice,
    normalizeResults
} = require("./s4-supplier-invoice");

async function syncSupplierInvoices({
    cds,
    request,
    top,
    entities
}) {
    const {
        Invoices,
        InvoiceItems,
        IntegrationRuns
    } = entities;

    const {
        SELECT,
        INSERT,
        UPDATE,
        DELETE
    } = cds.ql;

    const database = await cds.connect.to("db");
    const runID = cds.utils.uuid();
    const startedAt = new Date().toISOString();
    const executedBy = getUserID(request);

    await database.run(
        INSERT.into(IntegrationRuns).entries({
            ID: runID,
            integrationType: "S4_SUPPLIER_INVOICE_SYNC",
            status: "RUNNING",
            recordsRead: 0,
            headersUpserted: 0,
            itemsUpserted: 0,
            startedAt,
            executedBy,
            message: "Reading supplier invoices from S/4HANA."
        })
    );

    try {
        const headers = await getSupplierInvoices({ top });
        const deepInvoices = [];

        for (const header of headers) {
            const detailedInvoice = await getSupplierInvoice(
                header.SupplierInvoice,
                header.FiscalYear
            );

            deepInvoices.push(detailedInvoice);
        }

        let headersUpserted = 0;
        let itemsUpserted = 0;

        await database.tx(async (transaction) => {
            for (const source of deepInvoices) {
                const existing = await transaction.run(
                    SELECT.one
                        .from(Invoices)
                        .where({
                            supplierInvoice: source.SupplierInvoice,
                            fiscalYear: String(source.FiscalYear || "")
                        })
                );

                const sourceItems = normalizeResults(
                    source.to_SuplrInvcItemPurOrdRef
                );

                const invoiceID = existing?.ID || cds.utils.uuid();
                const headerEntry = mapHeader(source, sourceItems);

                if (existing) {
                    await transaction.run(
                        UPDATE(Invoices)
                            .set(headerEntry)
                            .where({ ID: invoiceID })
                    );
                } else {
                    await transaction.run(
                        INSERT.into(Invoices).entries({
                            ID: invoiceID,
                            ...headerEntry
                        })
                    );
                }

                await transaction.run(
                    DELETE.from(InvoiceItems).where({
                        invoice_ID: invoiceID
                    })
                );

                if (sourceItems.length > 0) {
                    const itemEntries = sourceItems.map((item) => ({
                        ID: cds.utils.uuid(),
                        invoice_ID: invoiceID,
                        ...mapItem(item)
                    }));

                    await transaction.run(
                        INSERT.into(InvoiceItems).entries(itemEntries)
                    );

                    itemsUpserted += itemEntries.length;
                }

                headersUpserted += 1;
            }
        });

        const completedAt = new Date().toISOString();
        const message =
            "S/4HANA synchronization completed: " +
            `${headersUpserted} invoice headers and ` +
            `${itemsUpserted} purchase-order reference items updated.`;

        await database.run(
            UPDATE(IntegrationRuns)
                .set({
                    status: "SUCCEEDED",
                    recordsRead: headers.length,
                    headersUpserted,
                    itemsUpserted,
                    completedAt,
                    message,
                    errorDetails: null
                })
                .where({ ID: runID })
        );

        return database.run(
            SELECT.one
                .from(IntegrationRuns)
                .where({ ID: runID })
        );
    } catch (error) {
        const completedAt = new Date().toISOString();

        await database.run(
            UPDATE(IntegrationRuns)
                .set({
                    status: "FAILED",
                    completedAt,
                    message:
                        "S/4HANA supplier invoice synchronization failed.",
                    errorDetails: getErrorMessage(error)
                })
                .where({ ID: runID })
        );

        throw error;
    }
}

function mapHeader(source, items) {
    const firstPurchaseOrderItem = items[0] || {};

    const purchaseOrders = uniqueValues(
        items.map((item) => item.PurchaseOrder)
    );

    const units = uniqueValues(
        items.map((item) => item.PurchaseOrderQuantityUnit)
    );

    const totalQuantity = items.reduce(
        (total, item) =>
            total + toNumber(item.QuantityInPurchaseOrderUnit),
        0
    );

    const supplierID = source.InvoicingParty || null;

    const paymentBlockingReason =
        source.PaymentBlockingReason || null;

    const purchaseOrder =
        firstPurchaseOrderItem.PurchaseOrder ||
        (purchaseOrders.length === 1
            ? purchaseOrders[0]
            : null);

    return removeUndefined({
        supplierInvoice: source.SupplierInvoice,
        fiscalYear: String(source.FiscalYear || ""),
        supplierID,
        supplierName:
            source.InvoicingPartyName1 ||
            source.SupplierName ||
            (supplierID ? `Supplier ${supplierID}` : null),
        supplierReference:
            source.SupplierInvoiceIDByInvcgParty || null,
        purchaseOrder,
        companyCode: source.CompanyCode || null,
        currency: source.DocumentCurrency || null,
        grossAmount: toNullableNumber(source.InvoiceGrossAmount),
        documentDate: toISODate(source.DocumentDate),
        postingDate: toISODate(source.PostingDate),
        dueDate: toISODate(source.DueCalculationBaseDate),
        invoiceQuantity:
            items.length > 0 ? totalQuantity : undefined,
        unit:
            units.length === 1 ? units[0] : undefined,
        sapInvoiceStatus:
            source.SupplierInvoiceStatus || null,
        paymentBlockingReason,
        blockReason: paymentBlockingReason
            ? `PAYMENT_BLOCK_${paymentBlockingReason}`
            : null,
        invoiceStatus: paymentBlockingReason
            ? "BLOCKED"
            : "SYNCED",
        sourceSystem: "S4HANA",
        sourceLastSyncedAt: new Date().toISOString(),
        manualBlock: false
    });
}

function mapItem(item) {
    return removeUndefined({
        supplierInvoiceItem: item.SupplierInvoiceItem,
        purchaseOrder: item.PurchaseOrder,
        purchaseOrderItem: item.PurchaseOrderItem,
        plant: item.Plant,
        referenceDocument: item.ReferenceDocument,
        referenceDocumentFiscalYear:
            item.ReferenceDocumentFiscalYear,
        referenceDocumentItem: item.ReferenceDocumentItem,
        documentCurrency: item.DocumentCurrency,
        supplierInvoiceItemAmount: toNullableNumber(
            item.SupplierInvoiceItemAmount
        ),
        purchaseOrderQuantityUnit:
            item.PurchaseOrderQuantityUnit,
        quantityInPurchaseOrderUnit: toNullableNumber(
            item.QuantityInPurchaseOrderUnit
        ),
        purchaseOrderPriceUnit: item.PurchaseOrderPriceUnit,
        quantityInPurchaseOrderPriceUnit: toNullableNumber(
            item.QtyInPurchaseOrderPriceUnit
        ),
        taxCode: item.TaxCode
    });
}

function normalizeDateValue(value) {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return value;
    }

    const odataDateMatch = String(value).match(
        /\/Date\((\d+)(?:[+-]\d+)?\)\//
    );

    if (odataDateMatch) {
        return new Date(Number(odataDateMatch[1]));
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function toISODate(value) {
    const date = normalizeDateValue(value);

    return date
        ? date.toISOString().slice(0, 10)
        : undefined;
}

function toNumber(value) {
    const number = Number(value);

    return Number.isFinite(number) ? number : 0;
}

function toNullableNumber(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return undefined;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : undefined;
}

function uniqueValues(values) {
    return [
        ...new Set(
            values.filter((value) => Boolean(value))
        )
    ];
}

function removeUndefined(entry) {
    return Object.fromEntries(
        Object.entries(entry).filter(
            ([, value]) => value !== undefined
        )
    );
}

function getUserID(request) {
    if (
        request?.user?.id &&
        request.user.id !== "anonymous"
    ) {
        return request.user.id;
    }

    return "SYSTEM";
}

function getErrorMessage(error) {
    return (
        error?.response?.data?.error?.message?.value ||
        error?.response?.data?.error?.message ||
        error?.message ||
        "Unknown S/4HANA synchronization error."
    );
}

module.exports = {
    syncSupplierInvoices
};
