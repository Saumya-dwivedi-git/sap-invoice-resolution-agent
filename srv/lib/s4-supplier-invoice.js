const {
    executeHttpRequest
} = require("@sap-cloud-sdk/http-client");

const DESTINATION_NAME = "S4H_SANDBOX";

const SERVICE_PATH =
    "/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV";

async function getSupplierInvoices(options = {}) {
    const top = Number(options.top || 20);

    try {
        const response = await executeHttpRequest(
            {
                destinationName: DESTINATION_NAME
            },
            {
                method: "GET",
                url: `${SERVICE_PATH}/A_SupplierInvoice`,
                params: {
                    "$format": "json",
                     "$top": top
                        },
                headers: {
                    Accept: "application/json"
                }
            }
        );

        return normalizeResults(response.data);
    } catch (error) {
    const responseBody = error.response?.data;

    console.error(
        "[S4_HTTP_ERROR]",
        JSON.stringify(
            {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: responseBody
            },
            null,
            2
        )
    );

    const sapMessage =
        responseBody?.error?.message?.value ||
        responseBody?.error?.message ||
        responseBody?.message ||
        error.message;

    throw new Error(
        `S/4HANA Supplier Invoice request failed: ${sapMessage}`
    );
}
}

async function getSupplierInvoice(
    supplierInvoice,
    fiscalYear
) {
    if (!supplierInvoice || !fiscalYear) {
        throw new Error(
            "Supplier invoice and fiscal year are required."
        );
    }

    try {
        const invoiceKey =
            escapeODataString(supplierInvoice);

        const yearKey =
            escapeODataString(fiscalYear);

        const response = await executeHttpRequest(
            {
                destinationName: DESTINATION_NAME
            },
            {
                method: "GET",
                url:
                    `${SERVICE_PATH}/A_SupplierInvoice(` +
                    `SupplierInvoice='${invoiceKey}',` +
                    `FiscalYear='${yearKey}')`,
                params: {
                    "$format": "json",
                    "$expand":
                        "to_SuplrInvcItemPurOrdRef"
                },
                headers: {
                    Accept: "application/json"
                }
            }
        );

        return response.data?.d || response.data;
    } catch (error) {
    const responseBody = error.response?.data;

    console.error(
        "[S4_HTTP_ERROR]",
        JSON.stringify(
            {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: responseBody
            },
            null,
            2
        )
    );

    const sapMessage =
        responseBody?.error?.message?.value ||
        responseBody?.error?.message ||
        responseBody?.message ||
        error.message;

    throw new Error(
        `S/4HANA Supplier Invoice request failed: ${sapMessage}`
    );
}
}

function normalizeResults(data) {
    if (Array.isArray(data?.d?.results)) {
        return data.d.results;
    }

    if (Array.isArray(data?.value)) {
        return data.value;
    }

    if (Array.isArray(data?.results)) {
        return data.results;
    }

    return [];
}

function escapeODataString(value) {
    return String(value).replace(/'/g, "''");
}

function createS4Error(error) {
    const message =
        error.response?.data?.error?.message?.value ||
        error.response?.data?.error?.message ||
        error.message;

    return new Error(
        `S/4HANA Supplier Invoice request failed: ${message}`
    );
}

module.exports = {
    getSupplierInvoices,
    getSupplierInvoice,
    normalizeResults
};