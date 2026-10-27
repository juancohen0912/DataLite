// Motor de fórmulas de DataLite, al estilo Excel. Seguro: no usa eval ni Function; todo es un intérprete propio.
//
// - Columnas calculadas: se evalúan fila por fila.     =[Ventas]-[Costo]   =SI([Ventas]>1000000;"Alta";"Baja")
// - Medidas: se evalúan sobre las filas de cada grupo. =SUMA([Ventas])/SUMA([Unidades])
// - Funciones propias: NOMBRE(param1; param2) = expresión con esos parámetros.
//
// Separadores: si la fórmula usa «;», la coma es decimal (Excel en español). Si no, la coma separa argumentos.

export const LIMITS = { maxLength: 2000, maxDepth: 60, maxUdfDepth: 8, maxNameLength: 60 };

export class FormulaError extends Error {
  constructor(message, pos = -1) { super(message); this.pos = pos; }
}

// Valor de error en tiempo de ejecución (equivalente a #¡DIV/0!, #¡VALOR!, etc.)
class XErr { constructor(code) { this.code = code; } toString() { return this.code; } }
const E = { DIV0: new XErr('#¡DIV/0!'), VALUE: new XErr('#¡VALOR!'), NA: new XErr('#N/D'), NUM: new XErr('#¡NUM!') };
export const isErr = (v) => v instanceof XErr;

// Vector de valores (una columna dentro de una medida)
class Vec { constructor(a) { this.a = a; } }
const isVec = (v) => v instanceof Vec;

export const normName = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/Ñ/g, 'N');

// ------------------------------------------------------------------ Tokens

const ID_START = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ_]/;
const ID_PART = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ_0-9.]/;

function hasSemicolon(src) {
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') inStr = !inStr;
    else if (!inStr && c === '[') { const j = src.indexOf(']', i); if (j < 0) return false; i = j; }
    else if (!inStr && c === ';') return true;
  }
  return false;
}

function tokenize(src) {
  const semi = hasSemicolon(src);
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const start = i;
    if (/[0-9]/.test(c) || (c === (semi ? ',' : '.') && /[0-9]/.test(src[i + 1] || ''))) {
      const dec = semi ? ',' : '.';
      let s = '';
      while (i < src.length && /[0-9]/.test(src[i])) s += src[i++];
      if (src[i] === dec && /[0-9]/.test(src[i + 1] || '')) { s += '.'; i++; while (i < src.length && /[0-9]/.test(src[i])) s += src[i++]; }
      if (/[eE]/.test(src[i] || '') && /[-+0-9]/.test(src[i + 1] || '')) {
        let e = src[i++]; if (/[-+]/.test(src[i])) e += src[i++];
        if (!/[0-9]/.test(src[i] || '')) throw new FormulaError('Número mal escrito.', start);
        while (i < src.length && /[0-9]/.test(src[i])) e += src[i++];
        s += e;
      }
      toks.push({ t: 'num', v: Number(s), pos: start });
      continue;
    }
    if (c === '"') {
      let s = ''; i++;
      for (;;) {
        if (i >= src.length) throw new FormulaError('Falta cerrar las comillas de un texto.', start);
        if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; }
        s += src[i++];
      }
      toks.push({ t: 'str', v: s, pos: start });
      continue;
    }
    if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new FormulaError('Falta cerrar el corchete de una columna: usa [Nombre de la columna].', start);
      const name = src.slice(i + 1, j).trim();
      if (!name) throw new FormulaError('Hay una columna vacía: escribe el nombre entre los corchetes.', start);
      toks.push({ t: 'col', v: name, pos: start });
      i = j + 1;
      continue;
    }
    if (ID_START.test(c)) {
      let s = '';
      while (i < src.length && ID_PART.test(src[i])) s += src[i++];
      toks.push({ t: 'id', v: s, pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') { toks.push({ t: 'op', v: two, pos: start }); i += 2; continue; }
    if ('+-*/^&=<>%()'.includes(c)) { toks.push({ t: 'op', v: c, pos: start }); i++; continue; }
    if (c === ';' || (!semi && c === ',')) { toks.push({ t: 'sep', pos: start }); i++; continue; }
    throw new FormulaError(`Carácter no válido: «${c}».`, start);
  }
  toks.push({ t: 'end', pos: src.length });
  return toks;
}

// ------------------------------------------------------------------ Parser (precedencia de Excel)

function parse(src) {
  if (typeof src !== 'string') throw new FormulaError('Escribe una fórmula.');
  let s = src.trim();
  if (s.startsWith('=')) s = s.slice(1);
  if (!s.trim()) throw new FormulaError('Escribe una fórmula.');
  if (s.length > LIMITS.maxLength) throw new FormulaError(`La fórmula es demasiado larga (máximo ${LIMITS.maxLength} caracteres).`);
  const offset = src.length - src.trimStart().length + (src.trim().startsWith('=') ? 1 : 0);
  const toks = tokenize(s).map((t) => ({ ...t, pos: t.pos + offset }));
  let p = 0, depth = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isOp = (v) => peek().t === 'op' && peek().v === v;
  const enter = () => { if (++depth > LIMITS.maxDepth) throw new FormulaError('La fórmula tiene demasiados niveles anidados.', peek().pos); };

  function binary(level, ops, sub) {
    enter();
    let a = sub();
    while (peek().t === 'op' && ops.includes(peek().v)) { const o = next(); a = { t: 'bin', op: o.v, a, b: sub(), pos: o.pos }; }
    depth--;
    return a;
  }
  const cmp = () => binary(0, ['=', '<>', '<', '>', '<=', '>='], concat);
  const concat = () => binary(1, ['&'], add);
  const add = () => binary(2, ['+', '-'], mul);
  const mul = () => binary(3, ['*', '/'], pow);
  const pow = () => binary(4, ['^'], unary);
  function unary() {
    enter();
    let r;
    if (isOp('-')) { const o = next(); r = { t: 'neg', a: unary(), pos: o.pos }; }
    else if (isOp('+')) { next(); r = unary(); }
    else r = postfix();
    depth--;
    return r;
  }
  function postfix() {
    let a = primary();
    while (isOp('%')) { const o = next(); a = { t: 'pct', a, pos: o.pos }; }
    return a;
  }
  function primary() {
    const tk = next();
    if (tk.t === 'num') return { t: 'num', v: tk.v };
    if (tk.t === 'str') return { t: 'str', v: tk.v };
    if (tk.t === 'col') return { t: 'ref', name: tk.v, pos: tk.pos };
    if (tk.t === 'op' && tk.v === '(') {
      const e = cmp();
      if (!isOp(')')) throw new FormulaError('Falta cerrar un paréntesis.', peek().pos);
      next();
      return e;
    }
    if (tk.t === 'id') {
      if (isOp('(')) {
        next();
        const args = [];
        if (!isOp(')')) {
          for (;;) {
            if (peek().t === 'sep' || isOp(')')) args.push({ t: 'empty' });
            else args.push(cmp());
            if (peek().t === 'sep') { next(); continue; }
            break;
          }
        }
        if (!isOp(')')) throw new FormulaError(`Falta cerrar el paréntesis de ${tk.v.toUpperCase()}( ).`, peek().pos);
        next();
        return { t: 'call', name: normName(tk.v), raw: tk.v, args, pos: tk.pos };
      }
      const n = normName(tk.v);
      if (n === 'VERDADERO' || n === 'TRUE') return { t: 'bool', v: true };
      if (n === 'FALSO' || n === 'FALSE') return { t: 'bool', v: false };
      return { t: 'name', name: n, raw: tk.v, pos: tk.pos };
    }
    if (tk.t === 'end') throw new FormulaError('La fórmula está incompleta.', tk.pos);
    if (tk.t === 'sep') throw new FormulaError('Sobra un separador de argumentos.', tk.pos);
    throw new FormulaError(`No esperaba «${tk.v}» aquí.`, tk.pos);
  }

  const ast = cmp();
  if (peek().t !== 'end') {
    const t = peek();
    throw new FormulaError(t.t === 'sep' ? 'Hay un separador fuera de una función.' : t.t === 'op' && t.v === ')' ? 'Sobra un paréntesis de cierre.' : 'Falta un operador entre dos valores.', t.pos);
  }
  return ast;
}

// ------------------------------------------------------------------ Conversión de tipos

const blank = (v) => v === null || v === undefined || v === '';
function toNum(v) {
  if (isErr(v)) return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime() / 86400000 + 25569; // número de serie de Excel
  if (blank(v)) return 0;
  const s = String(v).trim().replace(/\s/g, '');
  let n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n) && /^-?[\d.]+,\d+$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : E.VALUE;
}
function toBool(v) {
  if (isErr(v)) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (blank(v)) return false;
  const n = normName(v);
  if (n === 'VERDADERO' || n === 'TRUE' || n === 'SI') return true;
  if (n === 'FALSO' || n === 'FALSE' || n === 'NO') return false;
  return E.VALUE;
}
const numText = (n) => (Number.isInteger(n) ? String(n) : String(+n.toPrecision(15))).replace('.', ',');
function toText(v) {
  if (isErr(v)) return v;
  if (blank(v)) return '';
  if (typeof v === 'number') return numText(v);
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (v instanceof Date) return v.toLocaleDateString('es-CO');
  return String(v);
}
function toDate(v) {
  if (isErr(v)) return v;
  if (v instanceof Date) return v;
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  if (typeof v === 'string') {
    const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v.trim()) || null;
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
    if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  }
  return E.VALUE;
}
const dayDiff = (a, b) => Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);

function compare(a, b) {
  if (isErr(a)) return a; if (isErr(b)) return b;
  if (a instanceof Date) a = a.getTime(); if (b instanceof Date) b = b.getTime();
  if (blank(a)) a = typeof b === 'string' ? '' : 0;
  if (blank(b)) b = typeof a === 'string' ? '' : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === 'string' && typeof b === 'string') { const r = a.localeCompare(b, 'es', { sensitivity: 'base' }); return r < 0 ? -1 : r > 0 ? 1 : 0; }
  // Excel: números < textos < lógicos
  const rank = (x) => (typeof x === 'number' ? 0 : typeof x === 'string' ? 1 : 2);
  return rank(a) < rank(b) ? -1 : 1;
}

// Criterios de CONTAR.SI / SUMAR.SI: ">100", "<>Bogotá", "Bog*", 5
function criterion(c) {
  if (isErr(c)) return () => false;
  if (typeof c === 'number' || typeof c === 'boolean' || c instanceof Date) return (v) => compare(v, c) === 0;
  const s = String(c ?? '');
  const m = /^(<>|>=|<=|=|>|<)?(.*)$/s.exec(s);
  const op = m[1] || '=';
  const rhsRaw = m[2];
  const n = rhsRaw.trim() !== '' ? toNum(rhsRaw) : null;
  const rhs = typeof n === 'number' ? n : rhsRaw;
  if ((op === '=' || op === '<>') && typeof rhs === 'string' && /[*?]/.test(rhs)) {
    const re = new RegExp('^' + rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?') + '$', 'is');
    return op === '=' ? (v) => re.test(toText(v)) : (v) => !re.test(toText(v));
  }
  return (v) => {
    if (op === '=' && rhs === '') return blank(v);
    if (op === '<>' && rhs === '') return !blank(v);
    if (typeof rhs === 'number' && typeof v !== 'number' && !(v instanceof Date)) return op === '<>';
    const r = compare(v, rhs);
    if (isErr(r)) return false;
    return { '=': r === 0, '<>': r !== 0, '>': r > 0, '<': r < 0, '>=': r >= 0, '<=': r <= 0 }[op];
  };
}

// ------------------------------------------------------------------ Biblioteca de funciones

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function textFormat(v, fmtStr) {
  const f = String(fmtStr ?? '');
  if (v instanceof Date || /[dmyaDMYA]/.test(f) && !/[0#]/.test(f)) {
    const d = toDate(v); if (isErr(d)) return d;
    return f.replace(/dddd|ddd|dd|d|mmmm|mmm|mm|m|yyyy|aaaa|yy|aa/gi, (t) => {
      const k = t.toLowerCase();
      if (k === 'dddd') return DAYS[d.getDay()];
      if (k === 'ddd') return DAYS[d.getDay()].slice(0, 3);
      if (k === 'dd') return String(d.getDate()).padStart(2, '0');
      if (k === 'd') return String(d.getDate());
      if (k === 'mmmm') return MONTHS[d.getMonth()];
      if (k === 'mmm') return MONTHS[d.getMonth()].slice(0, 3);
      if (k === 'mm') return String(d.getMonth() + 1).padStart(2, '0');
      if (k === 'm') return String(d.getMonth() + 1);
      if (k === 'yyyy' || k === 'aaaa') return String(d.getFullYear());
      return String(d.getFullYear()).slice(-2);
    });
  }
  const n = toNum(v); if (isErr(n)) return n;
  const pct = f.includes('%');
  const val = pct ? n * 100 : n;
  const body = f.replace(/[^0#.,%]/g, '');
  const seps = [...body.matchAll(/[.,]/g)];
  let decimals = 0, grouped = false;
  if (seps.length) {
    const last = seps[seps.length - 1];
    const after = body.slice(last.index + 1).replace('%', '');
    const twoKinds = new Set(seps.map((x) => x[0])).size > 1;
    if (twoKinds || !(after.length === 3 && /#/.test(body.slice(0, last.index)))) { decimals = after.length; grouped = seps.length > 1; }
    else grouped = true;
  }
  const out = new Intl.NumberFormat('es-CO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped }).format(val);
  return (/^\$/.test(f) ? '$ ' : '') + out + (pct ? '%' : '');
}

const round = (x, d, mode) => {
  const k = 10 ** d;
  const v = x * k;
  const r = mode === 'up' ? Math.sign(v) * Math.ceil(Math.abs(v) - 1e-9) : mode === 'down' ? Math.trunc(v) : Math.sign(v) * Math.round(Math.abs(v) + 1e-9);
  return r / k;
};

// Cada función: [mínimo de argumentos, máximo, implementación]. Las implementaciones reciben valores ya evaluados
// (escalares), salvo las marcadas como perezosas (lazy) o de agregación (agg), que reciben funciones/vectores.
const F = {};
const def = (names, min, max, fn, opts = {}) => { const spec = { min, max, fn, ...opts, names }; for (const n of names) F[n] = spec; };
const num1 = (fn) => (x) => { const n = toNum(x); return isErr(n) ? n : fn(n); };

// Lógicas (perezosas: solo se evalúa la rama que se usa)
def(['SI', 'IF'], 2, 3, (ev, [c, a, b]) => { const v = toBool(ev(c)); if (isErr(v)) return v; return v ? ev(a) : b ? ev(b) : false; }, { lazy: true });
def(['SI.ERROR', 'IFERROR'], 2, 2, (ev, [a, b]) => { const v = ev(a); return isErr(v) ? ev(b) : v; }, { lazy: true });
def(['SI.ND', 'IFNA'], 2, 2, (ev, [a, b]) => { const v = ev(a); return v === E.NA ? ev(b) : v; }, { lazy: true });
def(['SI.CONJUNTO', 'IFS'], 2, 254, (ev, args) => {
  if (args.length % 2) return E.VALUE;
  for (let i = 0; i < args.length; i += 2) { const c = toBool(ev(args[i])); if (isErr(c)) return c; if (c) return ev(args[i + 1]); }
  return E.NA;
}, { lazy: true });
def(['CAMBIAR', 'SWITCH'], 3, 254, (ev, [x, ...rest]) => {
  const v = ev(x); if (isErr(v)) return v;
  for (let i = 0; i + 1 < rest.length; i += 2) if (compare(v, ev(rest[i])) === 0) return ev(rest[i + 1]);
  return rest.length % 2 ? ev(rest[rest.length - 1]) : E.NA;
}, { lazy: true });
def(['Y', 'AND'], 1, 255, (...a) => { for (const x of a) { const b = toBool(x); if (isErr(b)) return b; if (!b) return false; } return true; });
def(['O', 'OR'], 1, 255, (...a) => { let r = false; for (const x of a) { const b = toBool(x); if (isErr(b)) return b; if (b) r = true; } return r; });
def(['NO', 'NOT'], 1, 1, (x) => { const b = toBool(x); return isErr(b) ? b : !b; });
def(['ESBLANCO', 'ISBLANK'], 1, 1, (x) => blank(x));
def(['ESNUMERO', 'ISNUMBER'], 1, 1, (x) => typeof x === 'number');
def(['ESTEXTO', 'ISTEXT'], 1, 1, (x) => typeof x === 'string' && x !== '');
def(['ESERROR', 'ISERROR'], 1, 1, (ev, [a]) => isErr(ev(a)), { lazy: true });

// Matemáticas
def(['ABS'], 1, 1, num1(Math.abs));
def(['REDONDEAR', 'ROUND'], 1, 2, (x, d = 0) => { const n = toNum(x), k = toNum(d); return isErr(n) ? n : isErr(k) ? k : round(n, Math.trunc(k)); });
def(['REDONDEAR.MAS', 'ROUNDUP'], 1, 2, (x, d = 0) => { const n = toNum(x), k = toNum(d); return isErr(n) ? n : isErr(k) ? k : round(n, Math.trunc(k), 'up'); });
def(['REDONDEAR.MENOS', 'ROUNDDOWN', 'TRUNCAR', 'TRUNC'], 1, 2, (x, d = 0) => { const n = toNum(x), k = toNum(d); return isErr(n) ? n : isErr(k) ? k : round(n, Math.trunc(k), 'down'); });
def(['ENTERO', 'INT'], 1, 1, num1(Math.floor));
def(['RESIDUO', 'MOD'], 2, 2, (a, b) => { const x = toNum(a), y = toNum(b); if (isErr(x)) return x; if (isErr(y)) return y; if (y === 0) return E.DIV0; return x - y * Math.floor(x / y); });
def(['POTENCIA', 'POWER'], 2, 2, (a, b) => { const x = toNum(a), y = toNum(b); if (isErr(x)) return x; if (isErr(y)) return y; const r = x ** y; return Number.isFinite(r) ? r : E.NUM; });
def(['RAIZ', 'SQRT'], 1, 1, num1((n) => (n < 0 ? E.NUM : Math.sqrt(n))));
def(['LN'], 1, 1, num1((n) => (n <= 0 ? E.NUM : Math.log(n))));
def(['LOG10'], 1, 1, num1((n) => (n <= 0 ? E.NUM : Math.log10(n))));
def(['LOG'], 1, 2, (a, b = 10) => { const x = toNum(a), y = toNum(b); if (isErr(x)) return x; if (isErr(y)) return y; return x <= 0 || y <= 0 || y === 1 ? E.NUM : Math.log(x) / Math.log(y); });
def(['EXP'], 1, 1, num1(Math.exp));
def(['SIGNO', 'SIGN'], 1, 1, num1(Math.sign));
def(['PI'], 0, 0, () => Math.PI);
def(['DIVIDIR', 'DIVIDE'], 2, 3, (a, b, alt) => { const x = toNum(a), y = toNum(b); if (isErr(x)) return x; if (isErr(y)) return y; return y === 0 ? (alt === undefined ? null : alt) : x / y; });

// Texto
def(['CONCATENAR', 'CONCAT', 'CONCATENATE'], 1, 255, (...a) => { let s = ''; for (const x of a) { const t = toText(x); if (isErr(t)) return t; s += t; } return s; });
def(['IZQUIERDA', 'LEFT'], 1, 2, (t, n = 1) => { const s = toText(t), k = toNum(n); if (isErr(s)) return s; if (isErr(k) || k < 0) return E.VALUE; return s.slice(0, k); });
def(['DERECHA', 'RIGHT'], 1, 2, (t, n = 1) => { const s = toText(t), k = toNum(n); if (isErr(s)) return s; if (isErr(k) || k < 0) return E.VALUE; return k === 0 ? '' : s.slice(-k); });
def(['EXTRAE', 'MID'], 3, 3, (t, a, n) => { const s = toText(t), i = toNum(a), k = toNum(n); if (isErr(s)) return s; if (isErr(i) || isErr(k) || i < 1 || k < 0) return E.VALUE; return s.substr(i - 1, k); });
def(['LARGO', 'LEN'], 1, 1, (t) => { const s = toText(t); return isErr(s) ? s : s.length; });
def(['MAYUSC', 'UPPER'], 1, 1, (t) => { const s = toText(t); return isErr(s) ? s : s.toLocaleUpperCase('es'); });
def(['MINUSC', 'LOWER'], 1, 1, (t) => { const s = toText(t); return isErr(s) ? s : s.toLocaleLowerCase('es'); });
def(['NOMPROPIO', 'PROPER'], 1, 1, (t) => { const s = toText(t); return isErr(s) ? s : s.toLocaleLowerCase('es').replace(/(^|[^\p{L}])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase('es')); });
def(['ESPACIOS', 'TRIM', 'RECORTAR'], 1, 1, (t) => { const s = toText(t); return isErr(s) ? s : s.trim().replace(/\s+/g, ' '); });
def(['SUSTITUIR', 'SUBSTITUTE'], 3, 4, (t, a, b, n) => {
  const s = toText(t), x = toText(a), y = toText(b); if (isErr(s)) return s; if (isErr(x)) return x; if (isErr(y)) return y;
  if (!x) return s;
  if (n === undefined) return s.split(x).join(y);
  const k = toNum(n); if (isErr(k) || k < 1) return E.VALUE;
  let idx = -1; for (let i = 0; i < k; i++) { idx = s.indexOf(x, idx + 1); if (idx < 0) return s; }
  return s.slice(0, idx) + y + s.slice(idx + x.length);
});
def(['ENCONTRAR', 'FIND'], 2, 3, (a, t, i = 1) => { const x = toText(a), s = toText(t), k = toNum(i); if (isErr(x)) return x; if (isErr(s)) return s; const r = s.indexOf(x, k - 1); return r < 0 ? E.VALUE : r + 1; });
def(['HALLAR', 'SEARCH'], 2, 3, (a, t, i = 1) => { const x = toText(a), s = toText(t), k = toNum(i); if (isErr(x)) return x; if (isErr(s)) return s; const r = s.toLocaleLowerCase('es').indexOf(x.toLocaleLowerCase('es'), k - 1); return r < 0 ? E.VALUE : r + 1; });
def(['REPETIR', 'REPT'], 2, 2, (t, n) => { const s = toText(t), k = toNum(n); if (isErr(s)) return s; if (isErr(k) || k < 0 || s.length * k > 10000) return E.VALUE; return s.repeat(Math.trunc(k)); });
def(['TEXTO', 'TEXT'], 2, 2, (v, f) => textFormat(v, f));
def(['VALOR', 'VALUE'], 1, 1, (t) => toNum(t));
def(['T'], 1, 1, (v) => (typeof v === 'string' ? v : ''));

// Fechas
def(['HOY', 'TODAY'], 0, 0, () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); });
def(['AHORA', 'NOW'], 0, 0, () => new Date());
def(['FECHA', 'DATE'], 3, 3, (y, m, d) => { const a = toNum(y), b = toNum(m), c = toNum(d); if ([a, b, c].some(isErr)) return E.VALUE; return new Date(a, b - 1, c); });
const datePart = (fn) => (v) => { if (blank(v)) return null; const d = toDate(v); return isErr(d) ? d : fn(d); };
def(['ANO', 'YEAR'], 1, 1, datePart((d) => d.getFullYear()));
def(['MES', 'MONTH'], 1, 1, datePart((d) => d.getMonth() + 1));
def(['DIA', 'DAY'], 1, 1, datePart((d) => d.getDate()));
def(['HORA', 'HOUR'], 1, 1, datePart((d) => d.getHours()));
def(['TRIMESTRE', 'QUARTER'], 1, 1, datePart((d) => Math.floor(d.getMonth() / 3) + 1));
def(['NOMBRE.MES', 'MONTHNAME'], 1, 1, datePart((d) => MONTHS[d.getMonth()]));
def(['NOMBRE.DIA', 'DAYNAME'], 1, 1, datePart((d) => DAYS[d.getDay()]));
def(['DIASEM', 'WEEKDAY'], 1, 2, (v, t = 1) => {
  if (blank(v)) return null; const d = toDate(v); if (isErr(d)) return d; const k = toNum(t);
  const w = d.getDay();
  return k === 2 ? (w === 0 ? 7 : w) : k === 3 ? (w === 0 ? 6 : w - 1) : w + 1;
});
def(['NUM.DE.SEMANA', 'WEEKNUM', 'ISO.NUM.DE.SEMANA', 'ISOWEEKNUM'], 1, 2, datePart((d) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}));
def(['FIN.MES', 'EOMONTH'], 2, 2, (v, m) => { const d = toDate(v), k = toNum(m); if (isErr(d)) return d; if (isErr(k)) return k; return new Date(d.getFullYear(), d.getMonth() + Math.trunc(k) + 1, 0); });
def(['FECHA.MES', 'EDATE'], 2, 2, (v, m) => { const d = toDate(v), k = toNum(m); if (isErr(d)) return d; if (isErr(k)) return k; const r = new Date(d.getFullYear(), d.getMonth() + Math.trunc(k), 1); r.setDate(Math.min(d.getDate(), new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate())); return r; });
def(['DIAS', 'DAYS'], 2, 2, (a, b) => { const x = toDate(a), y = toDate(b); if (isErr(x)) return x; if (isErr(y)) return y; return dayDiff(x, y); });
def(['SIFECHA', 'DATEDIF'], 3, 3, (a, b, u) => {
  const x = toDate(a), y = toDate(b); if (isErr(x)) return x; if (isErr(y)) return y; if (y < x) return E.NUM;
  const unit = normName(toText(u));
  let months = (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth();
  if (y.getDate() < x.getDate()) months--;
  if (unit === 'D') return dayDiff(y, x);
  if (unit === 'M') return months;
  if (unit === 'Y' || unit === 'A') return Math.floor(months / 12);
  return E.NUM;
});

// Agregaciones (en medidas reciben vectores; en columnas calculadas, los valores de sus argumentos)
const flat = (args) => { const out = []; for (const a of args) { if (isVec(a)) out.push(...a.a); else if (a !== undefined) out.push(a); } return out; };
const nums = (args, strict = false) => {
  const out = [];
  for (const a of args) {
    if (isVec(a)) { for (const v of a.a) { if (isErr(v)) return v; if (typeof v === 'number') out.push(v); } }
    else { if (isErr(a)) return a; if (strict && typeof a !== 'number') continue; const n = toNum(a); if (isErr(n)) return n; if (!blank(a)) out.push(n); }
  }
  return out;
};
const AGG = { agg: true };
def(['SUMA', 'SUM'], 1, 255, (...a) => { const v = nums(a); return isErr(v) ? v : v.reduce((s, x) => s + x, 0); }, AGG);
def(['PROMEDIO', 'AVERAGE'], 1, 255, (...a) => { const v = nums(a); if (isErr(v)) return v; return v.length ? v.reduce((s, x) => s + x, 0) / v.length : E.DIV0; }, AGG);
def(['MAX'], 1, 255, (...a) => { const v = nums(a); if (isErr(v)) return v; return v.length ? v.reduce((m, x) => (x > m ? x : m), -Infinity) : 0; }, AGG);
def(['MIN'], 1, 255, (...a) => { const v = nums(a); if (isErr(v)) return v; return v.length ? v.reduce((m, x) => (x < m ? x : m), Infinity) : 0; }, AGG);
def(['MEDIANA', 'MEDIAN'], 1, 255, (...a) => { const v = nums(a); if (isErr(v)) return v; if (!v.length) return E.NUM; v.sort((x, y) => x - y); const h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; }, AGG);
def(['DESVEST', 'DESVEST.M', 'STDEV', 'STDEV.S'], 1, 255, (...a) => { const v = nums(a); if (isErr(v)) return v; if (v.length < 2) return E.DIV0; const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); }, AGG);
def(['CONTAR', 'COUNT'], 1, 255, (...a) => flat(a).filter((v) => typeof v === 'number').length, AGG);
def(['CONTARA', 'COUNTA'], 1, 255, (...a) => flat(a).filter((v) => !blank(v)).length, AGG);
def(['CONTAR.BLANCO', 'COUNTBLANK'], 1, 1, (...a) => flat(a).filter(blank).length, AGG);
def(['CONTAR.UNICOS', 'DISTINCTCOUNT'], 1, 1, (...a) => new Set(flat(a).filter((v) => !blank(v)).map((v) => (v instanceof Date ? v.getTime() : typeof v === 'string' ? v.toLocaleLowerCase('es') : v))).size, AGG);
const asList = (x) => (isVec(x) ? x.a : [x]);
def(['CONTAR.SI', 'COUNTIF'], 2, 2, (r, c) => { const t = criterion(isVec(c) ? c.a[0] : c); return asList(r).filter(t).length; }, AGG);
def(['SUMAR.SI', 'SUMIF'], 2, 3, (r, c, s) => {
  const t = criterion(isVec(c) ? c.a[0] : c), list = asList(r), sum = s === undefined ? list : asList(s);
  let tot = 0; for (let i = 0; i < list.length; i++) if (t(list[i])) { const v = sum[i]; if (isErr(v)) return v; if (typeof v === 'number') tot += v; }
  return tot;
}, AGG);
def(['PROMEDIO.SI', 'AVERAGEIF'], 2, 3, (r, c, s) => {
  const t = criterion(isVec(c) ? c.a[0] : c), list = asList(r), sum = s === undefined ? list : asList(s);
  let tot = 0, n = 0; for (let i = 0; i < list.length; i++) if (t(list[i]) && typeof sum[i] === 'number') { tot += sum[i]; n++; }
  return n ? tot / n : E.DIV0;
}, AGG);
const conjunto = (pairs) => {
  const lists = [], tests = [];
  for (let i = 0; i < pairs.length; i += 2) { lists.push(asList(pairs[i])); tests.push(criterion(isVec(pairs[i + 1]) ? pairs[i + 1].a[0] : pairs[i + 1])); }
  const n = lists[0]?.length || 0;
  if (lists.some((l) => l.length !== n)) return null;
  return (i) => tests.every((t, k) => t(lists[k][i]));
};
def(['CONTAR.SI.CONJUNTO', 'COUNTIFS'], 2, 254, (...a) => { if (a.length % 2) return E.VALUE; const ok = conjunto(a); if (!ok) return E.VALUE; let n = 0; for (let i = 0; i < asList(a[0]).length; i++) if (ok(i)) n++; return n; }, AGG);
def(['SUMAR.SI.CONJUNTO', 'SUMIFS'], 3, 255, (s, ...a) => {
  if (a.length % 2) return E.VALUE; const ok = conjunto(a); const sum = asList(s);
  if (!ok || asList(a[0]).length !== sum.length) return E.VALUE;
  let t = 0; for (let i = 0; i < sum.length; i++) if (ok(i) && typeof sum[i] === 'number') t += sum[i];
  return t;
}, AGG);
def(['SUMAPRODUCTO', 'SUMPRODUCT'], 1, 30, (...a) => {
  const lists = a.map(asList); const n = lists[0].length;
  if (lists.some((l) => l.length !== n)) return E.VALUE;
  let t = 0; for (let i = 0; i < n; i++) { let p = 1; for (const l of lists) { const v = l[i]; if (isErr(v)) return v; p *= typeof v === 'number' ? v : typeof v === 'boolean' ? +v : 0; } t += p; }
  return t;
}, AGG);

/** Analiza una fórmula sin resolver columnas (para medidas que se referencian entre sí). */
export const parseFormula = (src) => parse(src);

/** Catálogo para la ayuda en pantalla. */
export const FUNCTION_HELP = [
  ['Lógicas', [['SI', 'SI(condición; si_verdadero; [si_falso])'], ['Y', 'Y(cond1; cond2; …)'], ['O', 'O(cond1; cond2; …)'], ['NO', 'NO(condición)'], ['SI.ERROR', 'SI.ERROR(valor; si_error)'], ['SI.CONJUNTO', 'SI.CONJUNTO(cond1; valor1; cond2; valor2; …)'], ['CAMBIAR', 'CAMBIAR(expresión; valor1; resultado1; …; [predeterminado])'], ['ESBLANCO', 'ESBLANCO(valor)'], ['ESNUMERO', 'ESNUMERO(valor)']]],
  ['Matemáticas', [['REDONDEAR', 'REDONDEAR(número; decimales)'], ['REDONDEAR.MAS', 'REDONDEAR.MAS(número; decimales)'], ['REDONDEAR.MENOS', 'REDONDEAR.MENOS(número; decimales)'], ['ENTERO', 'ENTERO(número)'], ['ABS', 'ABS(número)'], ['RESIDUO', 'RESIDUO(número; divisor)'], ['POTENCIA', 'POTENCIA(número; potencia)'], ['RAIZ', 'RAIZ(número)'], ['DIVIDIR', 'DIVIDIR(numerador; denominador; [si_cero]) — no falla si el denominador es 0'], ['LN', 'LN(número)'], ['LOG', 'LOG(número; [base])']]],
  ['Texto', [['CONCATENAR', 'CONCATENAR(texto1; texto2; …) o texto1 & texto2'], ['IZQUIERDA', 'IZQUIERDA(texto; caracteres)'], ['DERECHA', 'DERECHA(texto; caracteres)'], ['EXTRAE', 'EXTRAE(texto; inicio; caracteres)'], ['LARGO', 'LARGO(texto)'], ['MAYUSC', 'MAYUSC(texto)'], ['MINUSC', 'MINUSC(texto)'], ['NOMPROPIO', 'NOMPROPIO(texto)'], ['ESPACIOS', 'ESPACIOS(texto)'], ['SUSTITUIR', 'SUSTITUIR(texto; buscar; reemplazar)'], ['HALLAR', 'HALLAR(buscar; texto)'], ['TEXTO', 'TEXTO(valor; "0,00") o TEXTO([Fecha]; "mmmm yyyy")'], ['VALOR', 'VALOR(texto)']]],
  ['Fechas', [['AÑO', 'AÑO(fecha)'], ['MES', 'MES(fecha)'], ['DIA', 'DIA(fecha)'], ['TRIMESTRE', 'TRIMESTRE(fecha)'], ['NOMBRE.MES', 'NOMBRE.MES(fecha)'], ['NOMBRE.DIA', 'NOMBRE.DIA(fecha)'], ['DIASEM', 'DIASEM(fecha; [tipo])'], ['NUM.DE.SEMANA', 'NUM.DE.SEMANA(fecha)'], ['HOY', 'HOY()'], ['FECHA', 'FECHA(año; mes; día)'], ['FIN.MES', 'FIN.MES(fecha; meses)'], ['DIAS', 'DIAS(fecha_final; fecha_inicial)'], ['SIFECHA', 'SIFECHA(inicio; fin; "D"|"M"|"Y")']]],
  ['Agregación (medidas)', [['SUMA', 'SUMA([Columna])'], ['PROMEDIO', 'PROMEDIO([Columna])'], ['CONTAR', 'CONTAR([Columna]) — cuenta números'], ['CONTARA', 'CONTARA([Columna]) — cuenta celdas no vacías'], ['CONTAR.UNICOS', 'CONTAR.UNICOS([Columna])'], ['MAX', 'MAX([Columna])'], ['MIN', 'MIN([Columna])'], ['MEDIANA', 'MEDIANA([Columna])'], ['DESVEST', 'DESVEST([Columna])'], ['CONTAR.SI', 'CONTAR.SI([Columna]; ">100")'], ['SUMAR.SI', 'SUMAR.SI([Canal]; "Online"; [Ventas])'], ['PROMEDIO.SI', 'PROMEDIO.SI([Columna]; criterio; [promedio])'], ['CONTAR.SI.CONJUNTO', 'CONTAR.SI.CONJUNTO([Col1]; crit1; [Col2]; crit2)'], ['SUMAR.SI.CONJUNTO', 'SUMAR.SI.CONJUNTO([Suma]; [Col1]; crit1; …)'], ['SUMAPRODUCTO', 'SUMAPRODUCTO([Unidades]; [Precio])']]],
];

export const isBuiltin = (name) => Object.prototype.hasOwnProperty.call(F, normName(name));

// ------------------------------------------------------------------ Compilación con contexto

/**
 * Compila una fórmula.
 * ctx = { columns: [{name}], measures?: Map(normName -> ast), udfs?: Map(normName -> {params, ast}), kind: 'column'|'measure'|'udf', params?: [...] }
 * Devuelve { ast, deps: Set<índices de columnas>, usesMeasures: bool }.
 */
export function compile(src, ctx) {
  const ast = parse(src);
  const colIdx = new Map(ctx.columns.map((c, i) => [c.name.toLocaleLowerCase('es'), i]));
  const deps = new Set();
  let usesMeasures = false;
  const params = new Set((ctx.params || []).map(normName));

  function resolve(node, udfStack = [], measureStack = []) {
    switch (node.t) {
      case '__bound': return node.node; // argumento de una función propia, ya resuelto
      case 'num': case 'str': case 'bool': case 'empty': return node;
      case 'ref': {
        if (ctx.kind === 'udf') throw new FormulaError('Las funciones propias solo usan sus parámetros, no columnas. Pasa la columna como argumento al usarla.', node.pos);
        const key = node.name.toLocaleLowerCase('es');
        if (colIdx.has(key)) { const i = colIdx.get(key); deps.add(i); return { t: 'col', i, name: node.name }; }
        if (ctx.kind === 'measure' && ctx.measures?.has(key)) {
          if (measureStack.includes(key)) throw new FormulaError(`La medida [${node.name}] se usa a sí misma.`, node.pos);
          usesMeasures = true;
          return { t: 'measure', name: node.name, ast: resolve(ctx.measures.get(key), udfStack, [...measureStack, key]) };
        }
        throw new FormulaError(`No existe la columna [${node.name}].`, node.pos);
      }
      case 'name': {
        if (params.has(node.name)) return { t: 'param', name: node.name };
        throw new FormulaError(`No entiendo «${node.raw}». Si es una columna, escríbela entre corchetes: [${node.raw}].`, node.pos);
      }
      case 'neg': case 'pct': return { ...node, a: resolve(node.a, udfStack, measureStack) };
      case 'bin': return { ...node, a: resolve(node.a, udfStack, measureStack), b: resolve(node.b, udfStack, measureStack) };
      case 'call': {
        const spec = F[node.name];
        const args = node.args.map((a) => resolve(a, udfStack, measureStack));
        if (spec) {
          if (args.length < spec.min || args.length > spec.max) {
            const range = spec.min === spec.max ? `${spec.min}` : spec.max >= 254 ? `al menos ${spec.min}` : `entre ${spec.min} y ${spec.max}`;
            throw new FormulaError(`${node.raw.toUpperCase()} recibe ${range} argumento${spec.max === 1 ? '' : 's'}.`, node.pos);
          }
          return { t: 'fn', spec, name: node.name, args, pos: node.pos };
        }
        const udf = ctx.udfs?.get(node.name);
        if (udf) {
          if (udfStack.includes(node.name)) throw new FormulaError(`La función ${node.raw.toUpperCase()} se llama a sí misma.`, node.pos);
          if (udfStack.length >= LIMITS.maxUdfDepth) throw new FormulaError('Demasiadas funciones propias anidadas.', node.pos);
          if (args.length !== udf.params.length) throw new FormulaError(`${node.raw.toUpperCase()} recibe ${udf.params.length} argumento${udf.params.length === 1 ? '' : 's'}.`, node.pos);
          // Se expande la función reemplazando cada parámetro por su argumento
          const bind = new Map(udf.params.map((p, k) => [normName(p), args[k]]));
          const body = resolveUdf(udf.ast, bind, [...udfStack, node.name]);
          return body;
        }
        throw new FormulaError(`La función ${node.raw.toUpperCase()} no existe.`, node.pos);
      }
      default: throw new FormulaError('Fórmula no válida.');
    }
  }

  // Cuerpo de una función propia: sus nombres son parámetros
  function resolveUdf(node, bind, stack) {
    const walk = (n) => {
      if (n.t === 'name') { if (bind.has(n.name)) return bind.get(n.name); throw new FormulaError(`«${n.raw}» no es un parámetro de la función.`, n.pos); }
      if (n.t === 'ref') throw new FormulaError('Las funciones propias solo usan sus parámetros, no columnas. Pasa la columna como argumento al usarla.', n.pos);
      if (n.t === 'neg' || n.t === 'pct') return { ...n, a: walk(n.a) };
      if (n.t === 'bin') return { ...n, a: walk(n.a), b: walk(n.b) };
      if (n.t === 'call') return resolve({ ...n, args: n.args.map((a) => ({ t: '__bound', node: walk(a) })) }, stack);
      return n;
    };
    return walk(node);
  }

  const out = resolve(ast);
  if (ctx.kind === 'measure') checkMeasure(out);
  return { ast: out, deps, usesMeasures };
}

// Una medida debe devolver un solo valor: las columnas deben estar dentro de una agregación
function checkMeasure(ast) {
  const walk = (n, inAgg) => {
    if (n.t === 'col' && !inAgg) throw new FormulaError(`La columna [${n.name}] debe ir dentro de una agregación, por ejemplo SUMA([${n.name}]).`);
    if (n.t === 'fn') { for (const a of n.args) walk(a, inAgg || n.spec.agg); return; }
    if (n.t === 'bin') { walk(n.a, inAgg); walk(n.b, inAgg); return; }
    if (n.t === 'neg' || n.t === 'pct') walk(n.a, inAgg);
  };
  walk(ast, false);
}

/** Valida una función propia: nombre, parámetros y cuerpo. */
export function compileUdf({ name, params, body }, udfs = new Map()) {
  const n = String(name || '').trim();
  if (!/^[A-Za-zÁÉÍÓÚÑáéíóúñ_][A-Za-zÁÉÍÓÚÑáéíóúñ_0-9.]*$/.test(n) || n.length > LIMITS.maxNameLength) throw new FormulaError('El nombre debe empezar con una letra y solo llevar letras, números, puntos o guiones bajos.');
  if (isBuiltin(n) || ['VERDADERO', 'FALSO', 'TRUE', 'FALSE'].includes(normName(n))) throw new FormulaError(`${n.toUpperCase()} ya es una función de DataLite. Elige otro nombre.`);
  const ps = (params || []).map((p) => String(p).trim()).filter(Boolean);
  if (ps.length > 10) throw new FormulaError('Máximo 10 parámetros.');
  const seen = new Set();
  for (const p of ps) {
    if (!/^[A-Za-zÁÉÍÓÚÑáéíóúñ_][A-Za-zÁÉÍÓÚÑáéíóúñ_0-9]*$/.test(p)) throw new FormulaError(`El parámetro «${p}» no es válido: usa una sola palabra sin espacios.`);
    if (seen.has(normName(p))) throw new FormulaError(`El parámetro «${p}» está repetido.`);
    seen.add(normName(p));
  }
  const ast = parse(body);
  // Comprobación: compilar con parámetros ficticios
  const probe = new Map(udfs); probe.set(normName(n), { params: ps, ast });
  compile(`${n}(${ps.map(() => '0').join(';')})`, { columns: [], udfs: probe, kind: 'column' });
  return { name: n, key: normName(n), params: ps, ast };
}

// ------------------------------------------------------------------ Evaluación

function arith(op, a, b) {
  if (isErr(a)) return a; if (isErr(b)) return b;
  if (op === '&') { const x = toText(a), y = toText(b); return isErr(x) ? x : isErr(y) ? y : x + y; }
  if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
    const r = compare(a, b); if (isErr(r)) return r;
    return { '=': r === 0, '<>': r !== 0, '<': r < 0, '>': r > 0, '<=': r <= 0, '>=': r >= 0 }[op];
  }
  // Fechas: fecha - fecha = días; fecha ± número = fecha
  if (a instanceof Date && b instanceof Date && op === '-') return dayDiff(a, b);
  if (a instanceof Date && typeof b === 'number' && (op === '+' || op === '-')) { const d = new Date(a); d.setDate(d.getDate() + (op === '+' ? b : -b)); return d; }
  if (typeof a === 'number' && b instanceof Date && op === '+') { const d = new Date(b); d.setDate(d.getDate() + a); return d; }
  const x = toNum(a), y = toNum(b);
  if (isErr(x)) return x; if (isErr(y)) return y;
  let r;
  switch (op) {
    case '+': r = x + y; break;
    case '-': r = x - y; break;
    case '*': r = x * y; break;
    case '/': if (y === 0) return E.DIV0; r = x / y; break;
    case '^': r = x ** y; break;
    default: return E.VALUE;
  }
  return Number.isFinite(r) ? r : E.NUM;
}

// Aplica una operación escalar sobre vectores (elemento a elemento)
function lift(fn, args) {
  const vi = args.findIndex(isVec);
  if (vi < 0) return fn(...args);
  const n = args[vi].a.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(...args.map((a) => (isVec(a) ? a.a[i] : a)));
  return new Vec(out);
}

function evaluate(node, env) {
  switch (node.t) {
    case 'num': case 'str': case 'bool': return node.v;
    case 'empty': return null;
    case 'col': return env.col(node.i);
    case 'measure': return evaluate(node.ast, env);
    case 'neg': return lift((v) => { const n = toNum(v); return isErr(n) ? n : -n; }, [evaluate(node.a, env)]);
    case 'pct': return lift((v) => { const n = toNum(v); return isErr(n) ? n : n / 100; }, [evaluate(node.a, env)]);
    case 'bin': return lift((a, b) => arith(node.op, a, b), [evaluate(node.a, env), evaluate(node.b, env)]);
    case 'fn': {
      const { spec } = node;
      if (spec.lazy) {
        if (!env.vec) return spec.fn((a) => evaluate(a, env), node.args);
        // En medidas, una función perezosa con vectores se evalúa elemento a elemento
        const probe = node.args.map((a) => evaluate(a, env));
        const vi = probe.findIndex(isVec);
        if (vi < 0) return spec.fn((a) => evaluate(a, env), node.args);
        const n = probe[vi].a.length;
        const out = new Array(n);
        for (let i = 0; i < n; i++) {
          const pick = (k) => (isVec(probe[k]) ? probe[k].a[i] : probe[k]);
          out[i] = spec.fn((a) => pick(node.args.indexOf(a)), node.args);
        }
        return new Vec(out);
      }
      const args = node.args.map((a) => (a.t === 'empty' ? undefined : evaluate(a, env)));
      if (spec.agg) return spec.fn(...args);
      return lift(spec.fn, args);
    }
    default: return E.VALUE;
  }
}

/** Evalúa una columna calculada para una fila. */
export function evalRow(ast, row) {
  return evaluate(ast, { col: (i) => row[i], vec: false });
}

/** Evalúa una medida sobre un conjunto de filas (índices dentro de rows). */
export function evalMeasure(ast, rows, idx) {
  const cache = new Map();
  const v = evaluate(ast, {
    vec: true,
    col: (i) => {
      let c = cache.get(i);
      if (!c) { const a = new Array(idx ? idx.length : rows.length); if (idx) for (let k = 0; k < idx.length; k++) a[k] = rows[idx[k]][i]; else for (let k = 0; k < rows.length; k++) a[k] = rows[k][i]; c = new Vec(a); cache.set(i, c); }
      return c;
    },
  });
  if (isVec(v)) return E.VALUE;
  return v;
}

/** Valor final para mostrar o graficar: errores como null y lógicos como Sí/No. */
export function finalize(v) {
  if (isErr(v)) return null;
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}

export { toText as formulaText };
