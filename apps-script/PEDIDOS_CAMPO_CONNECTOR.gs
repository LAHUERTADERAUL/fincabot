const SPREADSHEET_ID = "18-LL567oDOU2ao5DUCJEbQpcoC1Xo9bm654p2iq0XRw";

function doGet(e) {
  const params = e.parameter || {};
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    if (params.test === "1") {
      return output({
        ok: true,
        mensaje: "FincaBot conectado",
        nombre: ss.getName(),
        fecha: new Date().toISOString()
      }, params.callback);
    }

    if (params.diagnostico === "1") {
      return output({
        ok: true,
        nombre: ss.getName(),
        hojas: ["PRODUCTOS", "VENTA", "VENTAS", "CLIENTES", "LISTA RECOLECTA"].map((name) => sheetInfo(ss, name))
      }, params.callback);
    }

    if (params.action === "loadState") {
      return output(loadFincaBotState(ss), params.callback);
    }
    if (params.action === "beginState") {
      return output(beginFincaBotState(ss, params), params.callback);
    }
    if (params.action === "stateChunk") {
      return output(saveFincaBotStateChunk(ss, params), params.callback);
    }
    if (params.action === "commitState") {
      return output(commitFincaBotState(ss, params), params.callback);
    }

    const payload = {
      ok: true,
      updatedAt: new Date().toISOString(),
      products: readObjects(ss, params.productsTab || "PRODUCTOS", 500, "first"),
      orders: readObjects(ss, params.ordersTab || "VENTA", 1200, "last"),
      saleLines: readObjects(ss, params.saleLinesTab || "VENTAS", 5000, "last"),
      clients: readObjects(ss, params.clientsTab || "CLIENTES", 1200, "first"),
      harvest: readObjects(ss, params.harvestTab || "LISTA RECOLECTA", 500, "first")
    };

    return output(payload, params.callback);
  } catch (err) {
    return output({
      ok: false,
      error: err && err.message ? err.message : String(err)
    }, params.callback);
  }
}

function getStateSheet(ss) {
  const name = "_FINCABOT_ESTADO";
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, 4).setValues([["KEY", "INDEX", "DATA", "UPDATED_AT"]]);
    sheet.hideSheet();
  }
  return sheet;
}

function loadFincaBotState(ss) {
  const sheet = getStateSheet(ss);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, exists: false };
  const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues()
    .filter((row) => row[0] === "state")
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  if (!rows.length) return { ok: true, exists: false };
  const json = rows.map((row) => row[2]).join("");
  const state = JSON.parse(json);
  return {
    ok: true,
    exists: true,
    updatedAt: state.meta && state.meta.updatedAt ? state.meta.updatedAt : rows[0][3],
    state
  };
}

function beginFincaBotState(ss, params) {
  const sheet = getStateSheet(ss);
  deleteRowsByKey(sheet, params.session);
  return { ok: true, session: params.session, total: Number(params.total || 0) };
}

function saveFincaBotStateChunk(ss, params) {
  const sheet = getStateSheet(ss);
  if (!params.session) return { ok: false, error: "Falta session" };
  sheet.appendRow([params.session, Number(params.index || 0), params.data || "", new Date().toISOString()]);
  return { ok: true, index: Number(params.index || 0) };
}

function commitFincaBotState(ss, params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getStateSheet(ss);
    const session = params.session;
    const total = Number(params.total || 0);
    if (!session) return { ok: false, error: "Falta session" };
    const lastRow = sheet.getLastRow();
    const rows = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    const chunks = rows
      .filter((row) => row[0] === session)
      .sort((a, b) => Number(a[1]) - Number(b[1]));
    if (chunks.length !== total) {
      return { ok: false, error: "Chunks incompletos: " + chunks.length + "/" + total };
    }
    const json = chunks.map((row) => row[2]).join("");
    JSON.parse(json);
    const storedChunks = splitText(json, 45000);
    sheet.clearContents();
    sheet.getRange(1, 1, 1, 4).setValues([["KEY", "INDEX", "DATA", "UPDATED_AT"]]);
    const now = new Date().toISOString();
    sheet.getRange(2, 1, storedChunks.length, 4).setValues(storedChunks.map((chunk, index) => ["state", index, chunk, now]));
    return { ok: true, chunks: storedChunks.length, updatedAt: now };
  } finally {
    lock.releaseLock();
  }
}

function deleteRowsByKey(sheet, key) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || !key) return;
  const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const kept = rows.filter((row) => row[0] !== key);
  sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  if (kept.length) sheet.getRange(2, 1, kept.length, 4).setValues(kept);
}

function splitText(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

function sheetInfo(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { sheetName, exists: false };
  return {
    sheetName,
    exists: true,
    rows: sheet.getLastRow(),
    columns: sheet.getLastColumn(),
    headers: sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
  };
}

function readObjects(ss, sheetName, limitRows, mode) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(String);
  const dataRows = lastRow - 1;
  const rowsToRead = Math.min(dataRows, limitRows || dataRows);
  const startRow = mode === "last" ? Math.max(2, lastRow - rowsToRead + 1) : 2;
  const values = sheet.getRange(startRow, 1, rowsToRead, lastColumn).getDisplayValues();

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
