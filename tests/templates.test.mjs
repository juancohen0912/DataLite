import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, autoMap, templateState, templateAoa } from '../src/app/templates.js';
import { buildTable } from '../src/lib/data.js';
import { buildModel } from '../src/lib/model.js';
import { deserializeVisuals, computeView } from '../src/app/visuals.js';

for (const tpl of TEMPLATES) {
  test(`plantilla ${tpl.name}: datos de ejemplo, fórmulas y visuales sin errores`, () => {
    const t = buildTable(templateAoa(tpl));
    assert.ok(t.rows.length >= 30);
    const map = autoMap(tpl, t.columns);
    for (const c of tpl.columns) assert.ok(map[c.key] !== undefined, `${tpl.id}: no reconoció ${c.label}`);
    const st = templateState(tpl, map, t.columns);
    const model = buildModel(t, st.formulas);
    for (const c of model.calc || []) assert.equal(c.error || null, null, `${tpl.id} columna ${c.name}: ${c.error}`);
    for (const m of model.measures || []) assert.equal(m.error || null, null, `${tpl.id} medida ${m.name}: ${m.error}`);
    const vis = deserializeVisuals(st.visuals, model.columns);
    assert.equal(vis.length, st.visuals.length, `${tpl.id}: ${st.visuals.length - vis.length} visuales con columnas que no existen`);
    for (const v of vis) {
      const view = computeView(model, () => model.rows, model.rows, v);
      if (v.type === 'kpi') assert.ok(Number.isFinite(view.value), `${tpl.id} ${v.title}: ${view.value}`);
      else assert.ok(view.items.length > 0, `${tpl.id} ${v.type} sin datos`);
    }
  });
}

test('autoMap reconoce nombres distintos y no reutiliza columnas', () => {
  const tpl = TEMPLATES.find((t) => t.id === 'ventas');
  const cols = [{ name: 'Fecha de factura', type: 'date' }, { name: 'Artículo', type: 'text' }, { name: 'Asesor comercial', type: 'text' }, { name: 'Total', type: 'number' }, { name: 'Municipio', type: 'text' }];
  const m = autoMap(tpl, cols);
  assert.equal(m.fecha, 0); assert.equal(m.producto, 1); assert.equal(m.vendedor, 2); assert.equal(m.valor, 3); assert.equal(m.ciudad, 4);
  assert.equal(new Set(Object.values(m)).size, Object.values(m).length);
});
