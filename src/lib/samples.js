// Datos de ejemplo generados en el navegador (ficticios).

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

export const SAMPLES = [
  { id: 'ventas', label: 'Ventas de una tienda', hint: '1.200 filas con regiones, productos y vendedores' },
  { id: 'produccion', label: 'Producción de campos petroleros', hint: 'Campos, pozos y barriles diarios' },
  { id: 'gastos', label: 'Gastos personales', hint: 'Un año de gastos por categoría' },
];

export function makeSample(id) {
  const r = rng(id.length * 7919 + 17);
  if (id === 'produccion') {
    const fields = [
      { campo: 'Quifa', pozos: ['QF-01', 'QF-07', 'QF-12'], base: 900 },
      { campo: 'Rubiales', pozos: ['RB-03', 'RB-21'], base: 1200 },
      { campo: 'Cubiro', pozos: ['CB-02', 'CB-05'], base: 420 },
      { campo: 'Guatiquía', pozos: ['GT-11'], base: 650 },
    ];
    const aoa = [['Fecha', 'Campo', 'Pozo', 'Crudo (bbl)', 'Agua (bbl)', 'Gas (kpc)', 'BSW (%)', 'Estado']];
    const start = new Date(2025, 0, 1);
    for (let d = 0; d < 365; d += 1) {
      const date = new Date(start.getTime() + d * 86400000);
      for (const f of fields) {
        if (r() < 0.5) continue;
        const pozo = pick(r, f.pozos);
        const decline = 1 - d / 1400;
        const oil = Math.round(f.base * decline * (0.85 + r() * 0.3));
        const water = Math.round(oil * (2 + r() * 6));
        aoa.push([date, f.campo, pozo, oil, water, Math.round(oil * (0.3 + r() * 0.4)),
          +(100 * water / (oil + water)).toFixed(1), r() < 0.06 ? 'En mantenimiento' : 'Produciendo']);
      }
    }
    return { name: 'Producción (ejemplo)', aoa };
  }
  if (id === 'gastos') {
    const cats = [['Mercado', 40000, 220000], ['Transporte', 6000, 45000], ['Restaurantes', 18000, 90000],
      ['Servicios', 60000, 180000], ['Entretenimiento', 15000, 80000], ['Salud', 20000, 150000], ['Ropa', 50000, 250000]];
    const pagos = ['Tarjeta débito', 'Tarjeta crédito', 'Efectivo', 'Nequi', 'Daviplata'];
    const aoa = [['Fecha', 'Categoría', 'Medio de pago', 'Valor (COP)', 'Descripción']];
    const start = new Date(2025, 0, 1);
    for (let d = 0; d < 365; d++) {
      const c = pick(r, cats);
      aoa.push([new Date(start.getTime() + d * 86400000), c[0], pick(r, pagos),
        Math.round((c[1] + r() * (c[2] - c[1])) / 100) * 100, `${c[0]} ${d % 7 === 5 ? 'fin de semana' : 'semana'}`]);
    }
    return { name: 'Gastos (ejemplo)', aoa };
  }
  const regions = { Andina: ['Bogotá', 'Medellín', 'Bucaramanga'], Caribe: ['Barranquilla', 'Cartagena'], Pacífica: ['Cali', 'Buenaventura'], Orinoquía: ['Villavicencio'] };
  const products = [
    ['Tecnología', 'Portátil', 2800000], ['Tecnología', 'Monitor', 750000], ['Tecnología', 'Audífonos', 180000],
    ['Hogar', 'Cafetera', 320000], ['Hogar', 'Licuadora', 240000], ['Oficina', 'Silla ergonómica', 690000],
    ['Oficina', 'Escritorio', 540000], ['Oficina', 'Resma de papel', 22000],
  ];
  const sellers = ['Andrea Gómez', 'Carlos Pérez', 'Luisa Martínez', 'Julián Rojas', 'Valentina Ríos', 'Santiago Díaz'];
  const channels = ['Tienda física', 'Tienda online', 'Distribuidor'];
  const aoa = [['Fecha', 'Región', 'Ciudad', 'Categoría', 'Producto', 'Vendedor', 'Canal', 'Unidades', 'Precio unitario', 'Ventas', 'Costo']];
  const start = new Date(2024, 0, 1);
  for (let i = 0; i < 1200; i++) {
    const date = new Date(start.getTime() + Math.floor(r() * 730) * 86400000);
    const region = pick(r, Object.keys(regions));
    const p = pick(r, products);
    const seasonal = date.getMonth() >= 10 ? 1.6 : 1;
    const units = Math.max(1, Math.round((1 + r() * 9) * seasonal * (p[2] < 100000 ? 4 : 1)));
    const price = Math.round(p[2] * (0.92 + r() * 0.16) / 100) * 100;
    const sales = units * price;
    aoa.push([date, region, pick(r, regions[region]), p[0], p[1], pick(r, sellers), pick(r, channels), units, price, sales, Math.round(sales * (0.55 + r() * 0.2))]);
  }
  return { name: 'Ventas (ejemplo)', aoa };
}
