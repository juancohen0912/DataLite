// Modelo de datos: tabla original + columnas calculadas + medidas + funciones propias del usuario.
import { compile, compileUdf, evalRow, finalize, parseFormula, FormulaError, normName } from './formula.js';

export const FORMULA_LIMITS = { columns: 40, measures: 60, functions: 30 };

const lower = (s) => String(s).trim().toLocaleLowerCase('es');

export function validName(name, taken) {
  const n = String(name || '').trim();
  if (!n) return 'Ponle un nombre.';
  if (n.length > 60) return 'El nombre es muy largo (máximo 60 caracteres).';
  if (/[[\]]/.test(n)) return 'El nombre no puede llevar corchetes.';
  if (taken.has(lower(n))) return `Ya existe una columna o medida llamada «${n}».`;
  return null;
}

function inferType(values) {
  let filled = 0, nums = 0, dates = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    filled++;
    if (typeof v === 'number') nums++;
    else if (v instanceof Date) dates++;
  }
  if (!filled) return 'number';
  if (dates / filled >= 0.9) return 'date';
  if (nums / filled >= 0.9) return 'number';
  return 'text';
}

/**
 * formulas = { columns: [{name, expr}], measures: [{name, expr, format?}], functions: [{name, params, body}] }
 * Devuelve { columns, rows, measures: [{name, expr, ast, error}], calc: [{name, expr, error, errors}], functions: [{..., error}], udfs }
 */
export function buildModel(base, formulas = {}) {
  const fns = formulas.functions || [];
  const calcs = formulas.columns || [];
  const meas = formulas.measures || [];

  // 1) Funciones propias (cada una puede usar las anteriores)
  const udfs = new Map();
  const functions = fns.map((f) => {
    try {
      if (udfs.has(normName(f.name))) throw new FormulaError(`Ya existe una función llamada ${f.name}.`);
      const c = compileUdf(f, udfs);
      udfs.set(c.key, c);
      return { ...f, error: null };
    } catch (e) { return { ...f, error: e.message }; }
  });

  // 2) Columnas calculadas, en orden: cada una puede usar las columnas anteriores
  const columns = base.columns.map((c) => ({ ...c }));
  const taken = new Set(columns.map((c) => lower(c.name)));
  let work = null; // copia de las filas, creada solo si hay columnas calculadas válidas
  const calc = [];
  for (const cdef of calcs) {
    const nameErr = validName(cdef.name, taken);
    if (nameErr) { calc.push({ ...cdef, error: nameErr }); continue; }
    let ast;
    try { ast = compile(cdef.expr, { columns, udfs, kind: 'column' }).ast; }
    catch (e) { calc.push({ ...cdef, error: e.message, pos: e.pos }); continue; }
    if (!work) work = base.rows.map((r) => r.slice());
    const vals = new Array(work.length);
    let errors = 0;
    for (let i = 0; i < work.length; i++) {
      const raw = evalRow(ast, work[i]);
      const v = finalize(raw);
      if (v === null && raw !== null && raw !== undefined && raw !== '') errors++;
      vals[i] = v;
    }
    const type = inferType(vals);
    if (type === 'text') for (let i = 0; i < vals.length; i++) if (vals[i] !== null && typeof vals[i] !== 'string') vals[i] = vals[i] instanceof Date ? vals[i].toLocaleDateString('es-CO') : String(vals[i]);
    const set = new Set();
    let filled = 0;
    for (let i = 0; i < vals.length; i++) { const v = vals[i]; set.add(v instanceof Date ? v.getTime() : v); if (v !== null && v !== '') filled++; work[i].push(v); }
    columns.push({ name: cdef.name.trim(), type, calc: true, unique: set.size, filled, nulls: vals.length - filled });
    taken.add(lower(cdef.name));
    calc.push({ ...cdef, error: null, errors });
  }
  const rows = work || base.rows;

  // 3) Medidas: pueden usarse entre sí por nombre
  const raw = new Map();
  for (const m of meas) { try { raw.set(lower(m.name), parseFormula(m.expr)); } catch { /* se informa abajo */ } }
  const measures = [];
  for (const m of meas) {
    const nameErr = validName(m.name, taken);
    if (nameErr) { measures.push({ ...m, error: nameErr }); continue; }
    taken.add(lower(m.name));
    try {
      const { ast } = compile(m.expr, { columns, udfs, measures: raw, kind: 'measure' });
      measures.push({ ...m, name: m.name.trim(), ast, error: null });
    } catch (e) { measures.push({ ...m, error: e.message, pos: e.pos }); }
  }

  return { columns, rows, calc, measures, functions, udfs };
}

/** Prueba una fórmula antes de guardarla: devuelve {ok, error, pos, preview}. */
export function tryFormula(kind, src, model, extra = {}) {
  try {
    if (kind === 'function') {
      compileUdf({ name: extra.name, params: extra.params, body: src }, model.udfs);
      return { ok: true };
    }
    const raw = new Map(model.measures.filter((m) => m.ast).map((m) => [lower(m.name), parseFormula(m.expr)]));
    const { ast } = compile(src, { columns: model.columns, udfs: model.udfs, measures: raw, kind: kind === 'measure' ? 'measure' : 'column' });
    return { ok: true, ast };
  } catch (e) { return { ok: false, error: e.message, pos: e.pos }; }
}

/** Referencia estable a una métrica: número de columna o «m:Nombre» para medidas. */
export const measureRef = (name) => `m:${name}`;
export const isMeasureRef = (m) => typeof m === 'string' && m.startsWith('m:');
export const findMeasure = (model, ref) => (isMeasureRef(ref) ? model.measures.find((m) => m.ast && lower(m.name) === lower(ref.slice(2))) : null);
