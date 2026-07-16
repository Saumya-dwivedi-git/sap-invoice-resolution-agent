using { invoice.agent as db } from '../db/schema';

@path: '/invoice-agent'
service InvoiceAgentService {

    @readonly
    entity AgentCases as projection on db.AgentCases
        actions {
            action approveAndRelease() returns AgentCases;
        };

    @readonly
    entity Invoices as projection on db.Invoices
        actions {
            action runAgentForInvoice()
                returns AgentCases;

            action simulateSourceCorrection()
                returns AgentCases;
        };

    @readonly
    entity InvoiceItems as projection on db.InvoiceItems;

    @readonly
    entity AgentActions as projection on db.AgentActions;

    @readonly
    entity IntegrationRuns as projection on db.IntegrationRuns;

    action syncS4Invoices(
        top : Integer
    ) returns IntegrationRuns;

    action runAgent(
        invoiceID : UUID
    ) returns AgentCases;

    action approveCase(
        caseID     : UUID,
        approvedBy : String
    ) returns AgentCases;

    action simulateCorrection(
        invoiceID : UUID
    ) returns AgentCases;

    action simulateRelease(
        caseID : UUID
    ) returns AgentCases;
}