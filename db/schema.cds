namespace invoice.agent;

using { cuid, managed } from '@sap/cds/common';

entity Invoices : cuid, managed {
    supplierInvoice       : String(20);
    fiscalYear            : String(4);
    supplierID            : String(20);
    supplierName          : String(100);
    supplierReference     : String(40);
    purchaseOrder         : String(20);
    companyCode           : String(4);
    currency              : String(3);
    grossAmount           : Decimal(15,2);

    documentDate          : Date;
    postingDate           : Date;
    paymentTerms          : String(4);
    sapInvoiceStatus      : String(10);
    paymentBlockingReason : String(10);

    invoiceQuantity       : Decimal(15,3);
    receivedQuantity      : Decimal(15,3);
    unit                  : String(3);

    invoiceUnitPrice      : Decimal(15,2);
    purchaseOrderPrice    : Decimal(15,2);
    priceTolerancePct     : Decimal(5,2);

    blockReason           : String(50);
    invoiceStatus         : String(30);
    dueDate               : Date;
    buyerEmail            : String(255);
    warehouseEmail        : String(255);
    duplicateReference    : String(20);
    manualBlock           : Boolean default false;

    sourceSystem          : String(30) default 'DEMO';
    sourceLastSyncedAt    : Timestamp;

    items : Composition of many InvoiceItems
        on items.invoice = $self;
}

entity InvoiceItems : cuid, managed {
    invoice                          : Association to Invoices not null;
    supplierInvoiceItem              : String(6);
    purchaseOrder                    : String(20);
    purchaseOrderItem                : String(10);
    plant                            : String(4);
    referenceDocument                : String(20);
    referenceDocumentFiscalYear      : String(4);
    referenceDocumentItem            : String(10);
    documentCurrency                 : String(3);
    supplierInvoiceItemAmount        : Decimal(15,2);
    purchaseOrderQuantityUnit        : String(3);
    quantityInPurchaseOrderUnit      : Decimal(15,3);
    purchaseOrderPriceUnit           : String(3);
    quantityInPurchaseOrderPriceUnit : Decimal(15,3);
    taxCode                          : String(2);
}

entity AgentCases : cuid, managed {
    invoice           : Association to Invoices;
    exceptionType     : String(50);
    explanation       : LargeString;
    recommendedAction : String(80);
    confidence        : Decimal(5,4);
    riskLevel         : String(20);
    caseStatus        : String(30);
    approvalRequired  : Boolean default false;
    resolution        : LargeString;
}

entity AgentActions : cuid, managed {
    agentCase       : Association to AgentCases;
    actionType      : String(50);
    actionStatus    : String(30);
    message         : LargeString;
    requestPayload  : LargeString;
    responsePayload : LargeString;
    executedBy      : String(100);
    executedAt      : Timestamp;
}

entity IntegrationRuns : cuid, managed {
    integrationType : String(50);
    status          : String(30);
    recordsRead     : Integer default 0;
    headersUpserted : Integer default 0;
    itemsUpserted   : Integer default 0;
    startedAt       : Timestamp;
    completedAt     : Timestamp;
    message         : LargeString;
    errorDetails    : LargeString;
    executedBy      : String(100);
}
