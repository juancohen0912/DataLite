// Plantillas por tipo de negocio: columnas esperadas, fórmulas y tablero listo.
// Cada plantilla trae datos de ejemplo (para el Excel descargable y la vista previa) y arma el
// estado del tablero con los nombres reales de las columnas del archivo del usuario.
import { norm } from '../lib/geo-match.js';

const r = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; };
const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
const d2 = (n) => String(n).padStart(2, '0');
const dateOf = (rnd, year = 2025) => new Date(year, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28));
const CITIES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Bucaramanga', 'Cartagena', 'Pereira', 'Villavicencio', 'Pasto', 'Ibagué'];

/** Columna esperada: key (rol), label (nombre sugerido), type, aliases para reconocerla, required. */
const col = (key, label, type, aliases = [], required = true) => ({ key, label, type, aliases: [label, ...aliases], required });

export const TEMPLATES = [
  {
    id: 'ventas', name: 'Ventas', emoji: '🛒', description: 'Ventas por mes, producto, vendedor y ciudad, con margen.',
    columns: [
      col('fecha', 'Fecha', 'date', ['fecha venta', 'fecha factura', 'dia']),
      col('producto', 'Producto', 'text', ['articulo', 'item', 'referencia', 'descripcion']),
      col('categoria', 'Categoría', 'text', ['linea', 'familia', 'tipo'], false),
      col('vendedor', 'Vendedor', 'text', ['asesor', 'comercial', 'ejecutivo'], false),
      col('ciudad', 'Ciudad', 'text', ['municipio', 'departamento', 'sede', 'plaza'], false),
      col('cantidad', 'Cantidad', 'number', ['unidades', 'cant'], false),
      col('valor', 'Valor venta', 'number', ['ventas', 'valor', 'total', 'venta', 'ingreso', 'monto']),
      col('costo', 'Costo', 'number', ['costo total', 'costo venta'], false),
    ],
    sample(rnd = r(7)) {
      const prods = [['Portátil', 'Tecnología', 3200000], ['Monitor', 'Tecnología', 780000], ['Silla ergonómica', 'Oficina', 890000], ['Escritorio', 'Oficina', 1150000], ['Cafetera', 'Hogar', 420000]];
      return Array.from({ length: 240 }, () => { const [p, c, price] = pick(rnd, prods); const q = 1 + Math.floor(rnd() * 5); const v = Math.round(q * price * (0.9 + rnd() * 0.2)); return [dateOf(rnd), p, c, pick(rnd, ['Laura Gómez', 'Andrés Ruiz', 'Camila Torres', 'Julián Pérez']), pick(rnd, CITIES), q, v, Math.round(v * (0.55 + rnd() * 0.15))]; });
    },
    build(n) {
      const f = { columns: [], measures: [], functions: [] };
      if (n.costo) { f.columns.push({ name: 'Margen', expr: `=[${n.valor}]-[${n.costo}]` }); f.measures.push({ name: 'Margen %', expr: `=SI.ERROR(SUMA([Margen])/SUMA([${n.valor}]);0)*100` }); }
      const v = [
        kpi(n.valor, 'SUM', 'Ventas'),
        n.costo ? kpi('m:Margen %', 'SUM', 'Margen %') : kpi(n.valor, 'AVG', 'Venta promedio'),
        n.cantidad ? kpi(n.cantidad, 'SUM', 'Unidades') : kpi(-1, 'COUNT', 'Transacciones'),
        n.vendedor ? kpi(n.vendedor, 'DISTINCT', 'Vendedores') : kpi(n.producto, 'DISTINCT', 'Productos'),
        n.costo ? { type: 'combo', group: n.fecha, gran: 'month', metric: n.valor, agg: 'SUM', metric2: 'Margen', agg2: 'SUM', size: 'full' } : { type: 'area', group: n.fecha, gran: 'month', metric: n.valor, agg: 'SUM', size: 'full' },
        { type: 'hbar', group: n.producto, metric: n.valor, agg: 'SUM', topN: '10', size: 'half' },
        n.ciudad ? { type: 'map', group: n.ciudad, metric: n.valor, agg: 'SUM', topN: 'ALL', size: 'half' } : null,
        n.categoria ? { type: 'donut', group: n.categoria, metric: n.valor, agg: 'SUM', size: 'half' } : null,
        n.vendedor ? { type: 'bar', group: n.vendedor, metric: n.valor, agg: 'SUM', size: 'half', title: 'Ventas por vendedor' } : null,
      ];
      return { formulas: f, visuals: v };
    },
  },
  {
    id: 'inventario', name: 'Inventario', emoji: '📦', description: 'Existencias, valor del inventario y productos por reponer.',
    columns: [
      col('producto', 'Producto', 'text', ['articulo', 'item', 'referencia', 'sku', 'descripcion']),
      col('categoria', 'Categoría', 'text', ['linea', 'familia', 'tipo'], false),
      col('bodega', 'Bodega', 'text', ['almacen', 'sede', 'ubicacion', 'ciudad'], false),
      col('existencias', 'Existencias', 'number', ['stock', 'cantidad', 'saldo', 'unidades', 'inventario']),
      col('minimo', 'Stock mínimo', 'number', ['minimo', 'punto reorden', 'stock minimo'], false),
      col('costo', 'Costo unitario', 'number', ['costo', 'precio costo', 'valor unitario'], false),
    ],
    sample(rnd = r(11)) {
      const prods = ['Tornillo 1/4', 'Tuerca 1/4', 'Cable 12 AWG', 'Breaker 20A', 'Tubo PVC 1/2', 'Pegante PVC', 'Llave de paso', 'Cinta aislante', 'Guantes nitrilo', 'Casco'];
      const out = [];
      for (const p of prods) for (const b of ['Bodega Norte', 'Bodega Sur', 'Bogotá']) out.push([p, pick(rnd, ['Ferretería', 'Eléctricos', 'Plomería', 'Seguridad']), b, Math.round(rnd() * 400), 40 + Math.round(rnd() * 60), Math.round(2000 + rnd() * 60000)]);
      return out;
    },
    build(n) {
      const f = { columns: [], measures: [], functions: [] };
      if (n.costo) f.columns.push({ name: 'Valor inventario', expr: `=[${n.existencias}]*[${n.costo}]` });
      if (n.minimo) f.columns.push({ name: 'Estado', expr: `=SI([${n.existencias}]<=[${n.minimo}];"Reponer";"OK")` });
      const v = [
        kpi(n.existencias, 'SUM', 'Unidades en inventario'),
        n.costo ? kpi('Valor inventario', 'SUM', 'Valor del inventario') : kpi(n.producto, 'DISTINCT', 'Productos'),
        kpi(n.producto, 'DISTINCT', 'Referencias'),
        n.bodega ? kpi(n.bodega, 'DISTINCT', 'Bodegas') : kpi(-1, 'COUNT', 'Registros'),
        n.minimo ? { type: 'donut', group: 'Estado', metric: -1, agg: 'COUNT', size: 'half', title: 'Referencias por reponer' } : null,
        { type: 'hbar', group: n.producto, metric: n.costo ? 'Valor inventario' : n.existencias, agg: 'SUM', topN: '15', size: 'half' },
        n.bodega ? { type: 'bar', group: n.bodega, metric: n.costo ? 'Valor inventario' : n.existencias, agg: 'SUM', size: 'half' } : null,
        n.categoria && n.bodega ? { type: 'matrix', group: n.categoria, split: n.bodega, metric: n.existencias, agg: 'SUM', size: 'full', heat: true } : null,
      ];
      return { formulas: f, visuals: v };
    },
  },
  {
    id: 'cartera', name: 'Cartera y cobranza', emoji: '💳', description: 'Saldo por edad de vencimiento, clientes y vendedor.',
    columns: [
      col('cliente', 'Cliente', 'text', ['tercero', 'razon social', 'nombre cliente']),
      col('factura', 'Factura', 'text', ['numero factura', 'documento', 'n factura'], false),
      col('vence', 'Fecha vencimiento', 'date', ['vencimiento', 'fecha vence', 'vence']),
      col('saldo', 'Saldo', 'number', ['saldo pendiente', 'valor pendiente', 'por cobrar', 'deuda', 'valor']),
      col('vendedor', 'Vendedor', 'text', ['asesor', 'comercial', 'ejecutivo'], false),
      col('ciudad', 'Ciudad', 'text', ['municipio', 'departamento', 'sede'], false),
    ],
    sample(rnd = r(23)) {
      const cl = ['Ferretería El Tornillo', 'Distribuidora La 80', 'Comercial Andina', 'Supermercado La Economía', 'Droguería San Jorge', 'Constructora Altos', 'Agro Llanos', 'Textiles del Valle'];
      const today = new Date(); const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      return Array.from({ length: 120 }, (_, i) => [pick(rnd, cl), `FV-${1000 + i}`, new Date(base.getTime() + (Math.round(rnd() * 150) - 110) * 86400000), Math.round((200 + rnd() * 9000) * 1000), pick(rnd, ['Laura Gómez', 'Andrés Ruiz', 'Camila Torres']), pick(rnd, CITIES)]);
    },
    build(n) {
      const f = { columns: [
        { name: 'Días vencido', expr: `=DIAS(HOY();[${n.vence}])` },
        { name: 'Edad', expr: '=SI.CONJUNTO([Días vencido]<=0;"Al día";[Días vencido]<=30;"1 a 30 días";[Días vencido]<=60;"31 a 60 días";[Días vencido]<=90;"61 a 90 días";VERDADERO;"Más de 90 días")' },
      ], measures: [{ name: 'Saldo vencido', expr: `=SUMA(SI([Días vencido]>0;[${n.saldo}];0))` }], functions: [] };
      const v = [
        kpi(n.saldo, 'SUM', 'Cartera total'),
        kpi('m:Saldo vencido', 'SUM', 'Saldo vencido'),
        kpi(n.cliente, 'DISTINCT', 'Clientes'),
        n.factura ? kpi(n.factura, 'DISTINCT', 'Facturas') : kpi(-1, 'COUNT', 'Documentos'),
        { type: 'bar', group: 'Edad', metric: n.saldo, agg: 'SUM', sort: 'label', size: 'half', title: 'Saldo por edad de cartera' },
        { type: 'hbar', group: n.cliente, metric: n.saldo, agg: 'SUM', topN: '10', size: 'half', title: 'Clientes con mayor saldo' },
        n.vendedor ? { type: 'matrix', group: n.vendedor, split: 'Edad', metric: n.saldo, agg: 'SUM', size: 'full', heat: true } : null,
        n.ciudad ? { type: 'map', group: n.ciudad, metric: n.saldo, agg: 'SUM', topN: 'ALL', size: 'half' } : null,
      ];
      return { formulas: f, visuals: v };
    },
  },
  {
    id: 'gastos', name: 'Gastos', emoji: '🧾', description: 'Gasto por mes, categoría y área, frente al presupuesto.',
    columns: [
      col('fecha', 'Fecha', 'date', ['fecha gasto', 'dia']),
      col('categoria', 'Categoría', 'text', ['rubro', 'tipo', 'clase', 'cuenta']),
      col('concepto', 'Concepto', 'text', ['descripcion', 'detalle', 'proveedor'], false),
      col('area', 'Área', 'text', ['centro costo', 'centro de costo', 'departamento', 'dependencia'], false),
      col('valor', 'Valor', 'number', ['monto', 'gasto', 'total', 'importe']),
      col('presupuesto', 'Presupuesto', 'number', ['ppto', 'meta', 'planeado'], false),
    ],
    sample(rnd = r(31)) {
      const cats = [['Arriendo', 'Administración', 3500000], ['Servicios públicos', 'Administración', 900000], ['Nómina', 'Recursos humanos', 18000000], ['Publicidad', 'Mercadeo', 2500000], ['Transporte', 'Operaciones', 1200000], ['Software', 'Tecnología', 800000]];
      const out = [];
      for (let m = 0; m < 12; m++) for (const [c, a, base] of cats) out.push([new Date(2025, m, 5 + Math.floor(rnd() * 20)), c, `${c} ${d2(m + 1)}/2025`, a, Math.round(base * (0.8 + rnd() * 0.45)), base]);
      return out;
    },
    build(n) {
      const f = { columns: [], measures: [], functions: [] };
      if (n.presupuesto) f.measures.push({ name: 'Ejecución %', expr: `=SI.ERROR(SUMA([${n.valor}])/SUMA([${n.presupuesto}]);0)*100` });
      const v = [
        kpi(n.valor, 'SUM', 'Gasto total'),
        n.presupuesto ? kpi('m:Ejecución %', 'SUM', 'Ejecución del presupuesto %') : kpi(n.valor, 'AVG', 'Gasto promedio'),
        kpi(n.categoria, 'DISTINCT', 'Categorías'),
        kpi(-1, 'COUNT', 'Movimientos'),
        n.presupuesto ? { type: 'combo', group: n.fecha, gran: 'month', metric: n.valor, agg: 'SUM', metric2: n.presupuesto, agg2: 'SUM', size: 'full' } : { type: 'area', group: n.fecha, gran: 'month', metric: n.valor, agg: 'SUM', size: 'full' },
        { type: 'donut', group: n.categoria, metric: n.valor, agg: 'SUM', size: 'half' },
        n.area ? { type: 'hbar', group: n.area, metric: n.valor, agg: 'SUM', size: 'half' } : null,
        n.area ? { type: 'matrix', group: n.categoria, split: n.area, metric: n.valor, agg: 'SUM', size: 'full', heat: true } : null,
      ];
      return { formulas: f, visuals: v };
    },
  },
  {
    id: 'produccion', name: 'Producción de campo', emoji: '🛢️', description: 'Barriles de crudo, agua y BSW por pozo, campo y departamento.',
    columns: [
      col('fecha', 'Fecha', 'date', ['dia', 'fecha produccion']),
      col('campo', 'Campo', 'text', ['bloque', 'activo'], false),
      col('pozo', 'Pozo', 'text', ['well', 'id pozo']),
      col('departamento', 'Departamento', 'text', ['dpto', 'municipio', 'ubicacion'], false),
      col('crudo', 'Crudo (bbl)', 'number', ['crudo', 'aceite', 'produccion', 'bopd', 'barriles', 'petroleo']),
      col('agua', 'Agua (bbl)', 'number', ['agua', 'bwpd', 'agua producida'], false),
      col('gas', 'Gas (kpc)', 'number', ['gas', 'kpcd', 'mpcd'], false),
    ],
    sample(rnd = r(41)) {
      const wells = [['Rubiales', 'RB-01', 'Meta'], ['Rubiales', 'RB-07', 'Meta'], ['Quifa', 'QF-12', 'Meta'], ['Cusiana', 'CU-03', 'Casanare'], ['Cupiagua', 'CP-05', 'Casanare'], ['Caño Limón', 'CL-21', 'Arauca'], ['La Cira', 'LC-110', 'Santander']];
      const out = [];
      for (let day = 0; day < 90; day++) for (const [c, w, dpt] of wells) { const oil = Math.round(300 + rnd() * 900 - day * 1.5); out.push([new Date(2025, 6, 1 + day), c, w, dpt, Math.max(50, oil), Math.round(oil * (2 + rnd() * 6)), Math.round(oil * (0.5 + rnd()))]); }
      return out;
    },
    build(n) {
      const f = { columns: [], measures: [], functions: [] };
      if (n.agua) f.measures.push({ name: 'BSW %', expr: `=SI.ERROR(SUMA([${n.agua}])/(SUMA([${n.agua}])+SUMA([${n.crudo}]));0)*100` });
      const v = [
        kpi(n.crudo, 'SUM', 'Crudo total (bbl)'),
        n.agua ? kpi('m:BSW %', 'SUM', 'BSW %') : kpi(n.crudo, 'AVG', 'Promedio por registro'),
        kpi(n.pozo, 'DISTINCT', 'Pozos'),
        n.gas ? kpi(n.gas, 'SUM', 'Gas total (kpc)') : kpi(-1, 'COUNT', 'Registros'),
        n.agua ? { type: 'combo', group: n.fecha, gran: 'day', metric: n.crudo, agg: 'SUM', metric2: n.agua, agg2: 'SUM', size: 'full' } : { type: 'area', group: n.fecha, gran: 'day', metric: n.crudo, agg: 'SUM', size: 'full' },
        { type: 'hbar', group: n.pozo, metric: n.crudo, agg: 'SUM', topN: '15', size: 'half' },
        n.departamento ? { type: 'map', group: n.departamento, metric: n.crudo, agg: 'SUM', topN: 'ALL', size: 'half' } : (n.campo ? { type: 'donut', group: n.campo, metric: n.crudo, agg: 'SUM', size: 'half' } : null),
        n.campo ? { type: 'bar', group: n.campo, metric: n.agua ? 'm:BSW %' : n.crudo, agg: 'SUM', size: 'half', title: n.agua ? 'BSW % por campo' : '' } : null,
      ];
      return { formulas: f, visuals: v };
    },
  },
];

function kpi(metric, agg, title) { return { type: 'kpi', metric, agg, size: 'quarter', title }; }

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || null;

/** Asigna automáticamente columnas del archivo a los roles de la plantilla (por nombre y tipo). */
export function autoMap(tpl, columns) {
  const used = new Set(); const map = {};
  for (const c of tpl.columns) {
    const keys = c.aliases.map(norm);
    let best = -1, score = 0;
    columns.forEach((col, i) => {
      if (used.has(i)) return;
      const nm = norm(col.name);
      let s = keys.includes(nm) ? 3 : keys.some((k) => k && (nm.includes(k) || k.includes(nm))) ? 2 : 0;
      if (!s) return;
      if (c.type === col.type) s += 1; else if (c.type !== 'text') s -= 2;
      if (s > score) { score = s; best = i; }
    });
    if (best >= 0 && score > 0) { map[c.key] = best; used.add(best); }
  }
  return map;
}

/** Estado inicial del tablero (como un proyecto guardado) con los nombres reales de las columnas. */
export function templateState(tpl, map, columns) {
  const names = {};
  for (const [k, i] of Object.entries(map)) if (i !== undefined && i !== null && i >= 0) names[k] = columns[i].name;
  const { formulas, visuals } = tpl.build(names);
  let seq = 0;
  const vis = visuals.filter(Boolean).map((v) => ({ id: `t${Date.now().toString(36)}${seq++}`, split: null, topN: '10', sort: 'auto', gran: 'month', title: '', size: 'half', agg: 'SUM', ...v }));
  return { v: 1, theme: 'datalite', formulas, visuals: vis, filters: [], template: tpl.id };
}

/** Datos de ejemplo como tabla (primera fila: encabezados). */
export function templateAoa(tpl) {
  return [tpl.columns.map((c) => c.label), ...tpl.sample()];
}
