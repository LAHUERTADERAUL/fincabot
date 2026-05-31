const SPREADSHEET_ID = "18-LL567oDOU2ao5DUCJEbQpcoC1Xo9bm654p2iq0XRw";
const ACCESS_TOKEN = ""; // Opcional: pon aqui una palabra secreta y la misma en FincaBot.

function doGet(e) {
  const params = e.parameter || {};
  if (ACCESS_TOKEN && params.token !== ACCESS_TOKEN) {
    return output({ error: "Token no valido" }, params.callback);
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const payload = {
    updatedAt: new Date().toISOString(),
    products: readObjects(ss, params.productsTab || "PRODUCTOS DISPONIBLES", 500),
    orders: readObjects(ss, params.ordersTab || "VENTA", 5000),
    saleLines: readObjects(ss, params.saleLinesTab || "VENTAS", 30000),
    clients: readObjects(ss, params.clientsTab || "CLIENTES", 2000),
    harvest: readObjects(ss, params.harvestTab || "LISTA RECOLECTA", 500)
  };

  return output(payload, params.callback);
}

function readObjects(ss, sheetName, limitRows) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const lastRow = Math.min(sheet.getLastRow(), limitRows || sheet.getLastRow());
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const headers = values.shift().map(String);
  return values
    .filter((row) => row.some((cell) => String(cell).trim() !== ""))
    .map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        if (header) item[header] = row[index];
      });
      return item;
    });
}

function output(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
