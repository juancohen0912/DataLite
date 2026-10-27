import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, tryFormula, findMeasure, measureRef } from '../src/lib/model.js';
import { pivot, applyFilters } from '../src/lib/data.js';

const base = {
  columns: [{ name: 'Fecha', type: 'date' }, { name: 'Región', type: 'text' }, { name: 'Ventas', type: 'number' }, { name: 'Costo', type: 'number' }],
  rows: [
    [new Date(2025, 0, 5), 'Andina', 100, 60], [new Date(2025, 0, 20), 'Caribe', 50, 45],
    [new Date(2025, 1, 2), 'Andina', 200, 110], [new Date(2025, 2, 9), 'Pacífica', 80, 20],
  ],
};

test('columnas calculadas encadenadas, medidas y funciones propias', () => {
  const m = buildModel(base, {
    functions: [{ name: 'MARGEN', params: ['v', 'c'], body: '=DIVIDIR(v-c;v;0)' }],
    columns: [{ name: 'Utilidad', expr: '=[Ventas]-[Costo]' }, { name: 'Nivel', expr: '=SI([Utilidad]>=40;"Alto";"Bajo")' }, { name: 'Año', expr: '=AÑO([Fecha])' }],
    measures: [{ name: 'Ventas totales', expr: '=SUMA([Ventas])' }, { name: 'Margen %', expr: '=MARGEN([Ventas totales];SUMA([Costo]))' }],
  });
  assert.deepEqual(m.calc.map((c) => c.error), [null, null, null]);
  assert.deepEqual(m.columns.slice(4).map((c) => [c.name, c.type]), [['Utilidad', 'number'], ['Nivel', 'text'], ['Año', 'number']]);
  assert.deepEqual(m.rows[0].slice(4), [40, 'Alto', 2025]);
  assert.equal(base.rows[0].length, 4, 'la tabla original no se modifica');
  const mm = findMeasure(m, measureRef('margen %'));
  assert.ok(mm && !mm.error);
  const p = pivot(m.rows, m.columns, { group: 1, measure: mm.ast, sort: 'label' });
  assert.deepEqual(p.items.map((i) => [i.label, +i.value.toFixed(4)]), [['Andina', 0.4333], ['Caribe', 0.1], ['Pacífica', 0.75]]);
  assert.equal(+p.total.toFixed(4), +((430 - 235) / 430).toFixed(4));
  const top = pivot(m.rows, m.columns, { group: 1, measure: findMeasure(m, 'm:Ventas totales').ast, topN: '1' });
  assert.deepEqual(top.items.map((i) => [i.label, i.value]), [['Andina', 300], ['Otros (2)', 130]]);
  const split = pivot(m.rows, m.columns, { group: 1, split: 5, measure: findMeasure(m, 'm:Ventas totales').ast, sort: 'label' });
  assert.equal(split.items[0].byS.Alto, 300);
});

test('errores por fórmula sin romper el resto', () => {
  const m = buildModel(base, {
    columns: [{ name: 'Mala', expr: '=[NoExiste]*2' }, { name: 'Ventas', expr: '=1' }, { name: 'Buena', expr: '=[Ventas]*2' }],
    measures: [{ name: 'M1', expr: '=[Ventas]' }, { name: 'Buena', expr: '=SUMA([Ventas])' }],
  });
  assert.match(m.calc[0].error, /No existe la columna/);
  assert.match(m.calc[1].error, /Ya existe/);
  assert.equal(m.calc[2].error, null);
  assert.match(m.measures[0].error, /agregación/);
  assert.match(m.measures[1].error, /Ya existe/);
  assert.equal(tryFormula('measure', '=SUMA([Buena])', m).ok, true);
  assert.equal(tryFormula('column', '=[Buena', m).ok, false);
});

test('filtro por rango de fechas', () => {
  const r = applyFilters(base.rows, [{ col: 0, from: '2025-01-10', to: '2025-02-02' }]);
  assert.deepEqual(r.map((x) => x[2]), [50, 200]);
  const r2 = applyFilters(base.rows, [{ col: 0, from: '2025-02-01' }, { col: 1, values: ['Andina'] }]);
  assert.deepEqual(r2.map((x) => x[2]), [200]);
});
