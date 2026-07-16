using InvoiceAgentService as service
    from '../../srv/invoice-agent-service';

annotate service.Invoices with {
    supplierInvoice
        @title: 'Supplier Invoice';

    fiscalYear
        @title: 'Fiscal Year';

    supplierID
        @title: 'Supplier ID';

    supplierName
        @title: 'Supplier';

    purchaseOrder
        @title: 'Purchase Order';

    companyCode
        @title: 'Company Code';

    currency
        @title: 'Currency';

    grossAmount
        @title: 'Gross Amount'
        @Measures.ISOCurrency: currency;

    invoiceQuantity
        @title: 'Invoice Quantity';

    receivedQuantity
        @title: 'Received Quantity';

    unit
        @title: 'Unit';

    invoiceUnitPrice
        @title: 'Invoice Price';

    purchaseOrderPrice
        @title: 'Purchase Order Price';

    priceTolerancePct
        @title: 'Price Tolerance %';

    blockReason
        @title: 'Block Reason';

    invoiceStatus
        @title: 'Status';

    dueDate
        @title: 'Due Date';

    buyerEmail
        @title: 'Buyer Email';

    warehouseEmail
        @title: 'Warehouse Email';

    duplicateReference
        @title: 'Duplicate Reference';

    manualBlock
        @title: 'Manual Block';
};

annotate service.Invoices with @(
    UI.HeaderInfo: {
        TypeName: 'Supplier Invoice',
        TypeNamePlural: 'Supplier Invoices',
        Title: {
            $Type: 'UI.DataField',
            Value: supplierInvoice
        },
        Description: {
            $Type: 'UI.DataField',
            Value: supplierName
        }
    },

    UI.SelectionFields: [
        supplierInvoice,
        supplierName,
        purchaseOrder,
        invoiceStatus,
        blockReason,
        companyCode
    ],

    UI.LineItem: [
        {
            $Type: 'UI.DataField',
            Value: supplierInvoice,
            Label: 'Supplier Invoice'
        },
        {
            $Type: 'UI.DataField',
            Value: supplierName,
            Label: 'Supplier'
        },
        {
            $Type: 'UI.DataField',
            Value: purchaseOrder,
            Label: 'Purchase Order'
        },
        {
            $Type: 'UI.DataField',
            Value: grossAmount,
            Label: 'Gross Amount'
        },
        {
            $Type: 'UI.DataField',
            Value: blockReason,
            Label: 'Block Reason'
        },
        {
            $Type: 'UI.DataField',
            Value: invoiceStatus,
            Label: 'Status'
        },
        {
            $Type: 'UI.DataField',
            Value: dueDate,
            Label: 'Due Date'
        },
        {
            $Type: 'UI.DataFieldForAction',
            Action: 'InvoiceAgentService.runAgentForInvoice',
            Label: 'Run Agent'
        },
        {
            $Type: 'UI.DataFieldForAction',
            Action: 'InvoiceAgentService.simulateSourceCorrection',
            Label: 'Simulate Correction'
        }
    ],

    UI.Identification: [
        {
            $Type: 'UI.DataFieldForAction',
            Action: 'InvoiceAgentService.runAgentForInvoice',
            Label: 'Run Agent'
        },
        {
            $Type: 'UI.DataFieldForAction',
            Action: 'InvoiceAgentService.simulateSourceCorrection',
            Label: 'Simulate Correction'
        }
    ],

    UI.FieldGroup #InvoiceDetails: {
        Data: [
            {
                $Type: 'UI.DataField',
                Value: supplierInvoice,
                Label: 'Supplier Invoice'
            },
            {
                $Type: 'UI.DataField',
                Value: fiscalYear,
                Label: 'Fiscal Year'
            },
            {
                $Type: 'UI.DataField',
                Value: supplierID,
                Label: 'Supplier ID'
            },
            {
                $Type: 'UI.DataField',
                Value: supplierName,
                Label: 'Supplier'
            },
            {
                $Type: 'UI.DataField',
                Value: purchaseOrder,
                Label: 'Purchase Order'
            },
            {
                $Type: 'UI.DataField',
                Value: companyCode,
                Label: 'Company Code'
            },
            {
                $Type: 'UI.DataField',
                Value: grossAmount,
                Label: 'Gross Amount'
            },
            {
                $Type: 'UI.DataField',
                Value: dueDate,
                Label: 'Due Date'
            },
            {
                $Type: 'UI.DataField',
                Value: invoiceStatus,
                Label: 'Status'
            },
            {
                $Type: 'UI.DataField',
                Value: blockReason,
                Label: 'Block Reason'
            }
        ]
    },

    UI.FieldGroup #MatchingDetails: {
        Data: [
            {
                $Type: 'UI.DataField',
                Value: invoiceQuantity,
                Label: 'Invoice Quantity'
            },
            {
                $Type: 'UI.DataField',
                Value: receivedQuantity,
                Label: 'Received Quantity'
            },
            {
                $Type: 'UI.DataField',
                Value: unit,
                Label: 'Unit'
            },
            {
                $Type: 'UI.DataField',
                Value: invoiceUnitPrice,
                Label: 'Invoice Unit Price'
            },
            {
                $Type: 'UI.DataField',
                Value: purchaseOrderPrice,
                Label: 'Purchase Order Price'
            },
            {
                $Type: 'UI.DataField',
                Value: priceTolerancePct,
                Label: 'Price Tolerance %'
            }
        ]
    },

    UI.FieldGroup #Communication: {
        Data: [
            {
                $Type: 'UI.DataField',
                Value: buyerEmail,
                Label: 'Buyer Email'
            },
            {
                $Type: 'UI.DataField',
                Value: warehouseEmail,
                Label: 'Warehouse Email'
            },
            {
                $Type: 'UI.DataField',
                Value: duplicateReference,
                Label: 'Duplicate Reference'
            },
            {
                $Type: 'UI.DataField',
                Value: manualBlock,
                Label: 'Manual Block'
            }
        ]
    },

    UI.Facets: [
        {
            $Type: 'UI.ReferenceFacet',
            ID: 'InvoiceDetailsFacet',
            Label: 'Invoice Details',
            Target: '@UI.FieldGroup#InvoiceDetails'
        },
        {
            $Type: 'UI.ReferenceFacet',
            ID: 'MatchingDetailsFacet',
            Label: 'Three-Way Match',
            Target: '@UI.FieldGroup#MatchingDetails'
        },
        {
            $Type: 'UI.ReferenceFacet',
            ID: 'CommunicationFacet',
            Label: 'Communication and Controls',
            Target: '@UI.FieldGroup#Communication'
        }
    ]
);