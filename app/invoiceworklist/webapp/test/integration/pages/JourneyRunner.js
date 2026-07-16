sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"invoice/agent/invoiceworklist/test/integration/pages/InvoicesList.gen",
	"invoice/agent/invoiceworklist/test/integration/pages/InvoicesObjectPage.gen"
], function (JourneyRunner, InvoicesListGenerated, InvoicesObjectPageGenerated) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('invoice/agent/invoiceworklist') + '/test/flp.html#app-preview',
        pages: {
			onTheInvoicesListGenerated: InvoicesListGenerated,
			onTheInvoicesObjectPageGenerated: InvoicesObjectPageGenerated
        },
        async: true
    });

    return runner;
});

