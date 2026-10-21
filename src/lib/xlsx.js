// Lector y escritor de hojas de cálculo propio (sin scripts de terceros).
// Soporta .xlsx / .xlsm (Office Open XML) y .ods (OpenDocument). Todo ocurre en el navegador.
import JSZip from 'jszip';

const MAX_ENTRY = 250 * 1024 * 1024;   // tamaño máximo descomprimido por archivo interno
const MAX_TOTAL = 400 * 1024 * 1024;   // tamaño máximo descomprimido total (protección contra "zip bombs")

async function openZip(buffer) {
  let zip;
  try { zip = await JSZip.loadAsync(buffer, { checkCRC32: false }); } catch {
    throw new Error('El archivo está dañado o no es un Excel válido. Intenta guardarlo de nuevo como .xlsx o CSV.');
  }
  let total = 0;
  for (const f of Object.values(zip.files)) {
    const size = f._data?.uncompressedSize ?? 0;
    total += size;
    if (size > MAX_ENTRY || total > MAX_TOTAL) throw new Error('El archivo es demasiado grande una vez descomprimido.');
    if (f.name.includes('..')) throw new Error('El archivo contiene rutas no válidas.');
  }
  return zip;
}

// Lee un XML interno quitando prefijos de namespace en los nombres de etiqueta (p. ej. <x:row>)
const text = async (zip, path) => (zip.file(path) ? (await zip.file(path).async('string')).replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, '<$1') : null);

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENT[e.toLowerCase()];
  });
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? decode(m[1]) : null; };
const allText = (xml) => { let out = ''; xml.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, t) => { out += t; return ''; }); return decode(out); };

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Formatos de número que representan fechas
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
function isDateFormat(code) {
  if (!code) return false;
  const clean = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[dmyhs]/i.test(clean) && !/^general$/i.test(clean.trim());
}

// "2025-01-01" o "2025-01-01T10:30:00" como hora local (no UTC), para no correr el día
function isoLocal(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return isNaN(d) ? null : d;
}

function serialToDate(v, date1904) {
  const ms = Math.round((v + (date1904 ? 1462 : 0) - 25569) * 86400000);
  const u = new Date(ms);
  if (isNaN(u)) return null;
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
}

async function readXlsx(zip, maxRows) {
  const wb = await text(zip, 'xl/workbook.xml');
  if (!wb) throw new Error('No encontramos hojas en el archivo. Si es un .xls antiguo, ábrelo y guárdalo como .xlsx.');
  const date1904 = /date1904="(1|true)"/.test(wb);
  const rels = (await text(zip, 'xl/_rels/workbook.xml.rels')) || '';
  const relMap = new Map();
  rels.replace(/<Relationship\b[^>]*>/g, (tag) => { relMap.set(attr(tag, 'Id'), attr(tag, 'Target')); return ''; });

  const shared = [];
  const ss = await text(zip, 'xl/sharedStrings.xml');
  if (ss) ss.replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (_, si) => { shared.push(allText(si)); return ''; });

  const dateStyles = [];
  const st = await text(zip, 'xl/styles.xml');
  if (st) {
    const custom = new Map();
    st.replace(/<numFmt\b[^>]*>/g, (tag) => { custom.set(+attr(tag, 'numFmtId'), attr(tag, 'formatCode')); return ''; });
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st);
    if (xfs) xfs[1].replace(/<xf\b[^>]*>/g, (tag) => {
      const id = +attr(tag, 'numFmtId') || 0;
      dateStyles.push(DATE_IDS.has(id) || isDateFormat(custom.get(id)));
      return '';
    });
  }

  const sheets = [];
  const sheetTags = wb.match(/<sheet\b[^>]*>/g) || [];
  for (const tag of sheetTags) {
    const name = attr(tag, 'name') || `Hoja ${sheets.length + 1}`;
    let target = relMap.get(attr(tag, 'r:id')) || '';
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    const xml = await text(zip, `xl/${target}`);
    if (!xml) continue;
    const aoa = [];
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    let rm;
    while ((rm = rowRe.exec(xml)) && aoa.length <= maxRows) {
      const row = [];
      let nextCol = 0;
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      const rowBody = rm[2] || '';
      while ((cm = cellRe.exec(rowBody))) {
        const a = cm[1], body = cm[2] || '';
        let ci = colIndex(attr(a, 'r'));
        if (ci < 0) ci = nextCol;
        nextCol = ci + 1;
        if (ci > 16383) continue;
        const t = attr(a, 't');
        const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
        const raw = vm ? decode(vm[1]) : null;
        let val = '';
        if (t === 's') val = raw !== null ? shared[+raw] ?? '' : '';
        else if (t === 'inlineStr') val = allText(body);
        else if (t === 'str') val = raw ?? '';
        else if (t === 'b') val = raw === '1' ? 'Sí' : 'No';
        else if (t === 'e') val = '';
        else if (t === 'd') val = isoLocal(raw) ?? '';
        else if (raw !== null && raw !== '') {
          const num = Number(raw);
          const s = attr(a, 's');
          val = Number.isFinite(num) ? (s !== null && dateStyles[+s] ? serialToDate(num, date1904) ?? num : num) : raw;
        }
        row[ci] = val;
      }
      const r = +attr(rm[1], 'r');
      const idx = Number.isFinite(r) && r > 0 ? r - 1 : aoa.length;
      if (idx > maxRows + 1000) break;
      while (aoa.length < idx) aoa.push([]);
      aoa[idx] = Array.from(row, (v) => (v === undefined ? '' : v));
    }
    if (aoa.some((r) => r.length)) sheets.push({ name, aoa });
  }
  return sheets;
}

async function readOds(zip, maxRows) {
  // OpenDocument necesita sus prefijos de namespace: se lee sin normalizar
  const xml = zip.file('content.xml') ? await zip.file('content.xml').async('string') : null;
  if (!xml) throw new Error('El archivo .ods no tiene contenido legible.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El archivo .ods está dañado.');
  const T = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const O = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
  const sheets = [];
  for (const table of doc.getElementsByTagNameNS(T, 'table')) {
    const aoa = [];
    for (const rowEl of table.getElementsByTagNameNS(T, 'table-row')) {
      const repeatRows = Math.min(+rowEl.getAttributeNS(T, 'number-rows-repeated') || 1, 1000);
      const row = [];
      for (const cell of rowEl.children) {
        if (cell.localName !== 'table-cell' && cell.localName !== 'covered-table-cell') continue;
        const rep = Math.min(+cell.getAttributeNS(T, 'number-columns-repeated') || 1, 1024);
        const type = cell.getAttributeNS(O, 'value-type');
        let v = '';
        if (type === 'float' || type === 'percentage' || type === 'currency') v = Number(cell.getAttributeNS(O, 'value'));
        else if (type === 'date') v = isoLocal(cell.getAttributeNS(O, 'date-value')) ?? '';
        else if (type === 'boolean') v = cell.getAttributeNS(O, 'boolean-value') === 'true' ? 'Sí' : 'No';
        else v = [...cell.getElementsByTagName('text:p')].map((p) => p.textContent).join('\n');
        for (let k = 0; k < rep && row.length < 16384; k++) row.push(v);
      }
      while (row.length && row[row.length - 1] === '') row.pop();
      for (let k = 0; k < repeatRows && aoa.length <= maxRows; k++) aoa.push(row.slice());
    }
    while (aoa.length && !aoa[aoa.length - 1].length) aoa.pop();
    if (aoa.length) sheets.push({ name: table.getAttributeNS(T, 'name') || `Hoja ${sheets.length + 1}`, aoa });
  }
  return sheets;
}

export async function readWorkbook(buffer, ext, maxRows) {
  const zip = await openZip(buffer);
  const sheets = ext === 'ods' ? await readOds(zip, maxRows) : await readXlsx(zip, maxRows);
  if (!sheets.length) throw new Error('El archivo no tiene hojas con datos.');
  return sheets;
}

// ---------- Escritura (.xlsx) ----------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/** Crea un .xlsx. Los textos se guardan como texto en línea: Excel nunca los interpreta como fórmulas. */
export async function writeXlsx(aoa, sheetName = 'Hoja1', widths = []) {
  const rows = aoa.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${colName(ci)}${ri + 1}`;
    const style = ri === 0 ? ' s="1"' : '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(v ?? '')}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}
