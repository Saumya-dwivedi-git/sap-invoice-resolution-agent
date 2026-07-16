const cds = require("@sap/cds");
const {
    syncSupplierInvoices
} = require("./lib/s4-invoice-sync");

module.exports = cds.service.impl(async function () {
    const {
    Invoices,
    InvoiceItems,
    AgentCases,
    AgentActions,
    IntegrationRuns
} = cds.entities("invoice.agent");

    const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;
    /*
     * Fiori bound actions
     */

    this.on(
        "runAgentForInvoice",
        "Invoices",
        async (request) => {
            const [{ ID }] = request.params;

            const result = await runAgent(ID, request);

            request.notify(
                getAgentSuccessMessage(result)
            );

            return result;
        }
    );

    this.on(
        "simulateSourceCorrection",
        "Invoices",
        async (request) => {
            const [{ ID }] = request.params;

            const result = await simulateCorrection(
                ID,
                request
            );

            request.notify(
                "Correction recorded. Run the agent again to revalidate the invoice."
            );

            return result;
        }
    );

    this.on(
        "approveAndRelease",
        "AgentCases",
        async (request) => {
            const [{ ID }] = request.params;

            const approvedBy =
                request.user?.id &&
                request.user.id !== "anonymous"
                    ? request.user.id
                    : "Finance Manager";

            const result = await approveCase(
                ID,
                approvedBy,
                request
            );

            request.notify(
                "Invoice approved and release completed successfully."
            );

            return result;
        }
    );

    /*
     * Unbound API actions
     */
    this.on("syncS4Invoices", async (request) => {
    const requestedTop = Number(
        request.data.top || 20
    );

    const top = Math.min(
        Math.max(requestedTop, 1),
        100
    );

    try {
        const result =
            await syncSupplierInvoices({
                cds,
                request,
                top,
                entities: {
                    Invoices,
                    InvoiceItems,
                    IntegrationRuns
                }
            });

        request.notify(result.message);

        return result;
    } catch (error) {
    const errorDetails = {
        message: error.message,
        stack: error.stack,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data
    };

    console.error(
        "[S4_SYNC_ERROR]",
        JSON.stringify(errorDetails, null, 2)
    );

    return request.reject(
        error.response?.status || 502,
        error.message || "S/4HANA synchronization failed"
    );
}
});
    this.on("runAgent", async (request) => {
        const { invoiceID } = request.data;

        return runAgent(invoiceID, request);
    });

    this.on("simulateCorrection", async (request) => {
        const { invoiceID } = request.data;

        return simulateCorrection(
            invoiceID,
            request
        );
    });

    this.on("approveCase", async (request) => {
        const {
            caseID,
            approvedBy
        } = request.data;

        return approveCase(
            caseID,
            approvedBy,
            request
        );
    });

    this.on("simulateRelease", async (request) => {
        const { caseID } = request.data;

        const caseRecord = await SELECT.one
            .from(AgentCases)
            .where({ ID: caseID });

        if (!caseRecord) {
            return request.reject(
                404,
                "Agent case not found"
            );
        }

        if (caseRecord.approvalRequired) {
            return request.reject(
                400,
                "Approval is required before release"
            );
        }

        const invoice = await SELECT.one
            .from(Invoices)
            .where({
                ID: caseRecord.invoice_ID
            });

        if (!invoice) {
            return request.reject(
                404,
                "Supplier invoice not found"
            );
        }

        await releaseInvoice(
            invoice,
            caseID,
            false
        );

        return SELECT.one
            .from(AgentCases)
            .where({ ID: caseID });
    });

    /*
     * Main agent execution
     */

    async function runAgent(
        invoiceID,
        request
    ) {
        const invoice = await SELECT.one
            .from(Invoices)
            .where({ ID: invoiceID });

        if (!invoice) {
            return request.reject(
                404,
                "Supplier invoice not found"
            );
        }

        const diagnosis =
            diagnoseInvoice(invoice);

        const caseID = cds.utils.uuid();

        await INSERT.into(AgentCases).entries({
            ID: caseID,
            invoice_ID: invoice.ID,
            exceptionType:
                diagnosis.exceptionType,
            explanation:
                diagnosis.explanation,
            recommendedAction:
                diagnosis.recommendedAction,
            confidence:
                diagnosis.confidence,
            riskLevel:
                diagnosis.riskLevel,
            caseStatus:
                diagnosis.caseStatus,
            approvalRequired:
                diagnosis.approvalRequired,
            resolution:
                diagnosis.resolution
        });

        await recordAction({
            caseID,
            actionType: "ANALYZE_INVOICE",
            actionStatus: "COMPLETED",
            message: diagnosis.explanation,
            requestPayload: JSON.stringify({
                invoiceID: invoice.ID,
                supplierInvoice:
                    invoice.supplierInvoice,
                purchaseOrder:
                    invoice.purchaseOrder,
                blockReason:
                    invoice.blockReason,
                invoiceStatus:
                    invoice.invoiceStatus
            }),
            responsePayload:
                JSON.stringify(diagnosis),
            executedBy:
                "INVOICE_RESOLUTION_AGENT"
        });

        switch (
            diagnosis.recommendedAction
        ) {
            case "SIMULATE_RELEASE":
                await releaseInvoice(
                    invoice,
                    caseID,
                    false
                );
                break;

            case "REQUEST_WAREHOUSE_CONFIRMATION":
                await sendWarehouseFollowUp(
                    invoice,
                    caseID
                );
                break;

            case "REQUEST_BUYER_REVIEW":
                await sendBuyerFollowUp(
                    invoice,
                    caseID
                );
                break;

            case "RETAIN_BLOCK":
                await retainPaymentBlock(
                    invoice,
                    caseID
                );
                break;

            case "REQUEST_APPROVAL":
                await createApprovalRequest(
                    invoice,
                    caseID
                );
                break;

            default:
                await recordAction({
                    caseID,
                    actionType:
                        "NO_ACTION_SELECTED",
                    actionStatus:
                        "ESCALATED",
                    message:
                        "The agent could not select an approved action.",
                    requestPayload:
                        JSON.stringify({
                            invoiceID:
                                invoice.ID
                        }),
                    responsePayload:
                        JSON.stringify({
                            diagnosis
                        }),
                    executedBy:
                        "INVOICE_RESOLUTION_AGENT"
                });
        }

        return SELECT.one
            .from(AgentCases)
            .where({ ID: caseID });
    }

    /*
     * Simulated source correction
     */

    async function simulateCorrection(
        invoiceID,
        request
    ) {
        const invoice = await SELECT.one
            .from(Invoices)
            .where({ ID: invoiceID });

        if (!invoice) {
            return request.reject(
                404,
                "Supplier invoice not found"
            );
        }

        await UPDATE(Invoices)
            .set({
                receivedQuantity:
                    invoice.invoiceQuantity,
                purchaseOrderPrice:
                    invoice.invoiceUnitPrice,
                manualBlock: false,
                blockReason:
                    "RECHECK_REQUIRED"
            })
            .where({ ID: invoiceID });

        const caseRecord =
            await findLatestCase(invoiceID);

        if (!caseRecord) {
            return request.reject(
                404,
                "Run the agent before simulating a correction"
            );
        }

        await UPDATE(AgentCases)
            .set({
                caseStatus: "OPEN",
                resolution:
                    "Source correction received. Invoice requires agent revalidation."
            })
            .where({
                ID: caseRecord.ID
            });

        await recordAction({
            caseID: caseRecord.ID,
            actionType:
                "SOURCE_CORRECTION_RECEIVED",
            actionStatus: "COMPLETED",
            message:
                "Goods receipt and purchasing information were corrected in the sandbox.",
            requestPayload:
                JSON.stringify({
                    invoiceID
                }),
            responsePayload:
                JSON.stringify({
                    receivedQuantity:
                        invoice.invoiceQuantity,
                    purchaseOrderPrice:
                        invoice.invoiceUnitPrice,
                    manualBlock: false,
                    blockReason:
                        "RECHECK_REQUIRED"
                }),
            executedBy:
                "SANDBOX_SIMULATOR"
        });

        return SELECT.one
            .from(AgentCases)
            .where({
                ID: caseRecord.ID
            });
    }

    /*
     * Human approval
     */

    async function approveCase(
        caseID,
        approvedBy,
        request
    ) {
        const caseRecord = await SELECT.one
            .from(AgentCases)
            .where({ ID: caseID });

        if (!caseRecord) {
            return request.reject(
                404,
                "Agent case not found"
            );
        }

        if (!caseRecord.approvalRequired) {
            return request.reject(
                400,
                "This case does not require approval"
            );
        }

        const invoice = await SELECT.one
            .from(Invoices)
            .where({
                ID: caseRecord.invoice_ID
            });

        if (!invoice) {
            return request.reject(
                404,
                "Supplier invoice not found"
            );
        }

        const approver =
            approvedBy || "Finance Manager";

        await recordAction({
            caseID,
            actionType: "HUMAN_APPROVAL",
            actionStatus: "APPROVED",
            message:
                `Invoice release approved by ${approver}.`,
            requestPayload:
                JSON.stringify({
                    approvedBy: approver
                }),
            responsePayload:
                JSON.stringify({
                    approved: true,
                    approvalTime:
                        new Date().toISOString()
                }),
            executedBy: approver
        });

        await releaseInvoice(
            invoice,
            caseID,
            true
        );

        return SELECT.one
            .from(AgentCases)
            .where({ ID: caseID });
    }

    /*
     * Agent actions
     */

    async function sendWarehouseFollowUp(
        invoice,
        caseID
    ) {
        await recordAction({
            caseID,
            actionType:
                "SEND_OUTLOOK_FOLLOW_UP",
            actionStatus: "SIMULATED",
            message:
                `Warehouse follow-up created for missing goods receipt on purchase order ${invoice.purchaseOrder}.`,
            requestPayload:
                JSON.stringify({
                    recipient:
                        invoice.warehouseEmail,
                    subject:
                        `Missing goods receipt for PO ${invoice.purchaseOrder}`,
                    supplierInvoice:
                        invoice.supplierInvoice
                }),
            responsePayload:
                JSON.stringify({
                    mode: "SANDBOX",
                    delivered: false,
                    simulated: true
                }),
            executedBy:
                "INVOICE_RESOLUTION_AGENT"
        });
    }

    async function sendBuyerFollowUp(
        invoice,
        caseID
    ) {
        await recordAction({
            caseID,
            actionType:
                "SEND_BUYER_FOLLOW_UP",
            actionStatus: "SIMULATED",
            message:
                `Buyer review requested for supplier invoice ${invoice.supplierInvoice}.`,
            requestPayload:
                JSON.stringify({
                    recipient:
                        invoice.buyerEmail,
                    purchaseOrder:
                        invoice.purchaseOrder,
                    supplierInvoice:
                        invoice.supplierInvoice
                }),
            responsePayload:
                JSON.stringify({
                    mode: "SANDBOX",
                    delivered: false,
                    simulated: true
                }),
            executedBy:
                "INVOICE_RESOLUTION_AGENT"
        });
    }

    async function retainPaymentBlock(
        invoice,
        caseID
    ) {
        await UPDATE(AgentCases)
            .set({
                caseStatus: "ESCALATED",
                resolution:
                    "Payment block retained for Accounts Payable review."
            })
            .where({ ID: caseID });

        await recordAction({
            caseID,
            actionType:
                "RETAIN_PAYMENT_BLOCK",
            actionStatus: "COMPLETED",
            message:
                "Potential duplicate detected. The payment block remains active.",
            requestPayload:
                JSON.stringify({
                    supplierInvoice:
                        invoice.supplierInvoice,
                    duplicateReference:
                        invoice.duplicateReference
                }),
            responsePayload:
                JSON.stringify({
                    blockRetained: true,
                    escalated: true
                }),
            executedBy:
                "INVOICE_RESOLUTION_AGENT"
        });
    }

    async function createApprovalRequest(
        invoice,
        caseID
    ) {
        await recordAction({
            caseID,
            actionType:
                "CREATE_APPROVAL_REQUEST",
            actionStatus: "PENDING",
            message:
                `Finance approval is required for supplier invoice ${invoice.supplierInvoice}.`,
            requestPayload:
                JSON.stringify({
                    supplierInvoice:
                        invoice.supplierInvoice,
                    grossAmount:
                        invoice.grossAmount,
                    currency:
                        invoice.currency,
                    manualBlock:
                        invoice.manualBlock
                }),
            responsePayload:
                JSON.stringify({
                    approvalRequired: true,
                    assignedRole:
                        "FINANCE_MANAGER"
                }),
            executedBy:
                "INVOICE_RESOLUTION_AGENT"
        });
    }

    async function releaseInvoice(
        invoice,
        caseID,
        approvalUsed
    ) {
        await UPDATE(Invoices)
            .set({
                invoiceStatus:
                    "SIMULATED_RELEASED",
                blockReason: null
            })
            .where({
                ID: invoice.ID
            });

        await UPDATE(AgentCases)
            .set({
                caseStatus: "RESOLVED",
                approvalRequired: false,
                resolution:
                    "Invoice passed validation and its release was simulated successfully."
            })
            .where({
                ID: caseID
            });

        await recordAction({
            caseID,
            actionType:
                "RELEASE_SUPPLIER_INVOICE",
            actionStatus: "SIMULATED",
            message:
                `Sandbox release completed for supplier invoice ${invoice.supplierInvoice}.`,
            requestPayload:
                JSON.stringify({
                    supplierInvoice:
                        invoice.supplierInvoice,
                    fiscalYear:
                        invoice.fiscalYear,
                    approvalUsed
                }),
            responsePayload:
                JSON.stringify({
                    mode:
                        "SAP_SANDBOX_SIMULATION",
                    released: true,
                    sapSystemChanged: false
                }),
            executedBy:
                "INVOICE_RESOLUTION_AGENT"
        });
    }

    /*
     * Audit helper
     */

    async function recordAction({
        caseID,
        actionType,
        actionStatus,
        message,
        requestPayload,
        responsePayload,
        executedBy
    }) {
        await INSERT.into(AgentActions).entries({
            ID: cds.utils.uuid(),
            agentCase_ID: caseID,
            actionType,
            actionStatus,
            message,
            requestPayload,
            responsePayload,
            executedBy,
            executedAt:
                new Date().toISOString()
        });
    }

    async function findLatestCase(
        invoiceID
    ) {
        const cases = await SELECT
            .from(AgentCases)
            .where({
                invoice_ID: invoiceID
            });

        return cases.sort(
            (left, right) =>
                new Date(right.createdAt) -
                new Date(left.createdAt)
        )[0];
    }

    /*
     * Deterministic policy engine
     */

    function diagnoseInvoice(invoice) {
    const hasValue = (value) =>
        value !== null &&
        value !== undefined &&
        value !== "";

    const hasNumber = (value) =>
        hasValue(value) &&
        Number.isFinite(Number(value));

    /*
     * Case 1: Potential duplicate
     */
    if (hasValue(invoice.duplicateReference)) {
        return {
            exceptionType: "POTENTIAL_DUPLICATE",
            explanation:
                `Supplier invoice may duplicate invoice ${invoice.duplicateReference}.`,
            recommendedAction: "RETAIN_BLOCK",
            confidence: 0.99,
            riskLevel: "HIGH",
            caseStatus: "ESCALATED",
            approvalRequired: false,
            resolution:
                "Payment block retained for Accounts Payable review."
        };
    }

    /*
     * Case 2: Missing data required for three-way matching
     */
    const missingFields = [];

    if (!hasValue(invoice.supplierInvoice)) {
        missingFields.push("supplier invoice");
    }

    if (!hasValue(invoice.fiscalYear)) {
        missingFields.push("fiscal year");
    }

    if (!hasValue(invoice.purchaseOrder)) {
        missingFields.push("purchase order");
    }

    if (!hasNumber(invoice.invoiceQuantity)) {
        missingFields.push("invoice quantity");
    }

    if (!hasNumber(invoice.receivedQuantity)) {
        missingFields.push("received quantity");
    }

    if (!hasNumber(invoice.invoiceUnitPrice)) {
        missingFields.push("invoice unit price");
    }

    if (!hasNumber(invoice.purchaseOrderPrice)) {
        missingFields.push("purchase order price");
    }

    if (!hasNumber(invoice.priceTolerancePct)) {
        missingFields.push("price tolerance");
    }

    if (missingFields.length > 0) {
        return {
            exceptionType: "INCOMPLETE_INVOICE_DATA",
            explanation:
                `The agent cannot complete the three-way match because the following data is missing: ${missingFields.join(", ")}.`,
            recommendedAction: "RETAIN_BLOCK",
            confidence: 1,
            riskLevel: "HIGH",
            caseStatus: "WAITING",
            approvalRequired: false,
            resolution:
                "Payment block retained until the required SAP invoice, purchase-order, and goods-receipt data is available."
        };
    }

    const invoiceQuantity =
        Number(invoice.invoiceQuantity);

    const receivedQuantity =
        Number(invoice.receivedQuantity);

    const quantityDifference =
        invoiceQuantity - receivedQuantity;

    /*
     * Case 3: Missing goods receipt
     */
    if (quantityDifference > 0) {
        return {
            exceptionType: "MISSING_GOODS_RECEIPT",
            explanation:
                `Invoice quantity exceeds received quantity by ${quantityDifference.toFixed(3)} ${invoice.unit || ""}.`,
            recommendedAction:
                "REQUEST_WAREHOUSE_CONFIRMATION",
            confidence: 0.96,
            riskLevel: "MEDIUM",
            caseStatus: "WAITING",
            approvalRequired: false,
            resolution:
                "Waiting for warehouse confirmation or goods receipt correction."
        };
    }

    const invoiceUnitPrice =
        Number(invoice.invoiceUnitPrice);

    const purchaseOrderPrice =
        Number(invoice.purchaseOrderPrice);

    const priceDifference = Math.abs(
        invoiceUnitPrice - purchaseOrderPrice
    );

    const priceVariance =
        purchaseOrderPrice === 0
            ? invoiceUnitPrice === 0
                ? 0
                : 100
            : (
                priceDifference /
                purchaseOrderPrice
            ) * 100;

    /*
     * Case 4: Price variance
     */
    if (
        priceVariance >
        Number(invoice.priceTolerancePct)
    ) {
        return {
            exceptionType: "PRICE_VARIANCE",
            explanation:
                `Price variance ${priceVariance.toFixed(2)}% exceeds the permitted tolerance of ${Number(invoice.priceTolerancePct).toFixed(2)}%.`,
            recommendedAction:
                "REQUEST_BUYER_REVIEW",
            confidence: 0.94,
            riskLevel: "MEDIUM",
            caseStatus: "WAITING",
            approvalRequired: false,
            resolution:
                "Waiting for purchasing-team review."
        };
    }

    /*
     * Case 5: Manual or financial approval
     */
    const hasSAPPaymentBlock =
        hasValue(invoice.paymentBlockingReason);

    if (
        invoice.manualBlock === true ||
        hasSAPPaymentBlock ||
        Number(invoice.grossAmount) > 10000
    ) {
        const reasons = [];

        if (invoice.manualBlock === true) {
            reasons.push("a manual payment block");
        }

        if (hasSAPPaymentBlock) {
            reasons.push(
                `SAP payment blocking reason ${invoice.paymentBlockingReason}`
            );
        }

        if (Number(invoice.grossAmount) > 10000) {
            reasons.push(
                "the invoice value exceeds the autonomous approval limit"
            );
        }

        return {
            exceptionType: "APPROVAL_POLICY",
            explanation:
                `The invoice is matched but requires finance approval because of ${reasons.join(" and ")}.`,
            recommendedAction: "REQUEST_APPROVAL",
            confidence: 0.98,
            riskLevel: "HIGH",
            caseStatus: "APPROVAL_REQUIRED",
            approvalRequired: true,
            resolution:
                "Waiting for finance-manager approval."
        };
    }

    /*
     * Case 6: Fully matched invoice
     */
    return {
        exceptionType: "BLOCK_NO_LONGER_VALID",
        explanation:
            "Invoice quantity, goods receipt, and purchase-order price match within the configured tolerance.",
        recommendedAction: "SIMULATE_RELEASE",
        confidence: 0.98,
        riskLevel: "LOW",
        caseStatus: "PROCESSING",
        approvalRequired: false,
        resolution:
            "Invoice is eligible for autonomous release."
    };
}

    /*
     * Friendly Fiori notifications
     */

    function getAgentSuccessMessage(result) {
        switch (result.exceptionType) {
            case "MISSING_GOODS_RECEIPT":
                return (
                    "Missing goods receipt identified. " +
                    "A warehouse follow-up was created."
                );

            case "PRICE_VARIANCE":
                return (
                    "Price variance identified. " +
                    "The invoice was sent for buyer review."
                );

            case "APPROVAL_POLICY":
                return (
                    "Analysis completed. " +
                    "Finance approval is required."
                );

            case "POTENTIAL_DUPLICATE":
                return (
                    "Potential duplicate identified. " +
                    "The payment block was retained."
                );

            case "BLOCK_NO_LONGER_VALID":
                return (
                    "Validation passed. " +
                    "The invoice release was completed."
                );
            case "INCOMPLETE_INVOICE_DATA":
                return (
                    "Required SAP matching data is incomplete. " +
                    "The payment block was retained."
             );
            default:
                return (
                    "Invoice analysis completed successfully."
                );
        }
    }
});


