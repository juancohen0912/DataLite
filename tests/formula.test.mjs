import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileUdf, evalRow, evalMeasure, finalize, FormulaError, parseFormula, isErr } from '../src/lib/formula.js';

const columns = [{ name: 'Fecha' }, { name: 'Región' }, { name: 'Ventas' }, { name: 'Costo' }, { name: 'Unidades' }, { name: 'Canal' }];
const rows = [
  [new Date(2025, 0, 15), 'Andina', 1000, 600, 10, 'Online'],
  [new Date(2025, 1, 3), 'Caribe', 500, 450, 5, 'Tienda'],
  [new Date(2025, 1, 20), 'Andina', 2000, 1100, 4, 'Online'],
  [new Date(2025, 3, 1), 'Pacífica', 0, 0, 0, 'Tienda'],
  [null, '', null, 10, null, ''],
];
const row = (f, r = rows[0], extra = {}) => finalize(evalRow(compile(f, { columns, kind: 'column', ...extra }).ast, r));
const measure = (f, idx, extra = {}) => finalize(evalMeasure(compile(f, { columns, kind: 'measure', ...extra }).ast, rows, idx));
const throwsMsg = (fn, re) => assert.throws(fn, (e) => e instanceof FormulaError && re.test(e.message));

test('aritmética y precedencia de Excel', () => {
  assert.equal(row('=1+2*3'), 7);
  assert.equal(row('=(1+2)*3'), 9);
  assert.equal(row('=-2^2'), 4);
  assert.equal(row('=2^3^2'), 64);
  assert.equal(row('=50%'), 0.5);
  assert.equal(row('=10/4'), 2.5);
  assert.equal(row('=1.5*2'), 3);
  assert.equal(row('=REDONDEAR(1,5*2;0)'), 3);
  assert.equal(row('=[Ventas]-[Costo]'), 400);
  assert.equal(row('=([Ventas]-[Costo])/[Ventas]'), 0.4);
  assert.equal(row('=[ventas]*2'), 2000, 'nombres de columna sin distinguir mayúsculas');
});

test('separadores: punto y coma con coma decimal, o coma como separador', () => {
  assert.equal(row('=REDONDEAR(2,345;2)'), 2.35);
  assert.equal(row('=REDONDEAR(2.345, 2)'), 2.35);
  assert.equal(row('=SI([Ventas]>500;"Alta";"Baja")'), 'Alta');
  assert.equal(row('=IF([Ventas]>5000, "Alta", "Baja")'), 'Baja');
});

test('división por cero y SI.ERROR', () => {
  assert.equal(row('=[Ventas]/[Unidades]', rows[3]), null);
  assert.equal(row('=SI.ERROR([Ventas]/[Unidades];0)', rows[3]), 0);
  assert.equal(row('=DIVIDIR([Ventas];[Unidades];-1)', rows[3]), -1);
  assert.equal(row('=IFERROR(1/0, "x")'), 'x');
});

test('lógicas', () => {
  assert.equal(row('=Y([Ventas]>100;[Canal]="online")'), 'Sí', 'comparación de texto sin distinguir mayúsculas');
  assert.equal(row('=O(FALSO;[Unidades]=10)'), 'Sí');
  assert.equal(row('=NO([Ventas]>100)'), 'No');
  assert.equal(row('=SI.CONJUNTO([Ventas]>1500;"A";[Ventas]>800;"B";VERDADERO;"C")'), 'B');
  assert.equal(row('=CAMBIAR([Región];"Andina";1;"Caribe";2;0)'), 1);
  assert.equal(row('=ESBLANCO([Región])', rows[4]), 'Sí');
});

test('texto', () => {
  assert.equal(row('=[Región]&" - "&[Canal]'), 'Andina - Online');
  assert.equal(row('=CONCATENAR("Total: ";[Ventas])'), 'Total: 1000');
  assert.equal(row('=IZQUIERDA([Región];3)'), 'And');
  assert.equal(row('=DERECHA([Región];2)'), 'na');
  assert.equal(row('=EXTRAE([Región];2;3)'), 'ndi');
  assert.equal(row('=LARGO([Región])'), 6);
  assert.equal(row('=MAYUSC([Región])'), 'ANDINA');
  assert.equal(row('=NOMPROPIO("juan cohen")'), 'Juan Cohen');
  assert.equal(row('=ESPACIOS("  a   b ")'), 'a b');
  assert.equal(row('=SUSTITUIR([Región];"a";"o")'), 'Andino');
  assert.equal(row('=HALLAR("DIN";[Región])'), 3);
  assert.equal(row('=TEXTO(1234,5;"#.##0,00")'), '1.234,50');
  assert.equal(row('=TEXTO(0,256;"0,0%")'), '25,6%');
  assert.equal(row('=TEXTO([Fecha];"mmmm yyyy")'), 'enero 2025');
  assert.equal(row('=VALOR("12,5")'), 12.5);
  assert.equal(row('=1&2'), '12');
});

test('fechas', () => {
  assert.equal(row('=AÑO([Fecha])'), 2025);
  assert.equal(row('=ANO([Fecha])'), 2025);
  assert.equal(row('=YEAR([Fecha])'), 2025);
  assert.equal(row('=MES([Fecha])'), 1);
  assert.equal(row('=DIA([Fecha])'), 15);
  assert.equal(row('=TRIMESTRE([Fecha])', rows[3]), 2);
  assert.equal(row('=NOMBRE.MES([Fecha])'), 'enero');
  assert.equal(row('=DIASEM([Fecha];2)'), 3, '15-ene-2025 fue miércoles');
  assert.equal(row('=FECHA(2025;3;1)-[Fecha]'), 45);
  assert.equal(row('=DIAS(FECHA(2025;12;31);FECHA(2025;1;1))'), 364);
  assert.equal(row('=SIFECHA(FECHA(2020;5;10);FECHA(2025;5;9);"Y")'), 4);
  assert.equal(+row('=FIN.MES([Fecha];1)'), +new Date(2025, 1, 28));
  assert.equal(+row('=[Fecha]+7'), +new Date(2025, 0, 22));
  assert.equal(row('=AÑO([Fecha])', rows[4]), null, 'fecha vacía da vacío');
  assert.equal(row('=NUM.DE.SEMANA(FECHA(2025;1;1))'), 1);
});

test('agregaciones en columnas calculadas operan sobre sus argumentos', () => {
  assert.equal(row('=MAX([Ventas];[Costo];5000)'), 5000);
  assert.equal(row('=SUMA([Ventas];[Costo])'), 1600);
  assert.equal(row('=PROMEDIO(1;2;3)'), 2);
});

test('medidas sobre grupos', () => {
  assert.equal(measure('=SUMA([Ventas])'), 3500);
  assert.equal(measure('=SUMA([Ventas])', [0, 2]), 3000);
  assert.equal(measure('=SUMA([Ventas])/SUMA([Unidades])', [0, 2]), 3000 / 14);
  assert.equal(measure('=SUMA([Ventas]-[Costo])', [0, 1]), 450);
  assert.equal(measure('=PROMEDIO([Ventas])'), 875);
  assert.equal(measure('=CONTAR([Ventas])'), 4);
  assert.equal(measure('=CONTARA([Región])'), 4);
  assert.equal(measure('=CONTAR.UNICOS([Región])'), 3);
  assert.equal(measure('=MAX([Ventas])'), 2000);
  assert.equal(measure('=MIN([Costo])'), 0);
  assert.equal(measure('=MEDIANA([Ventas])'), 750);
  assert.equal(measure('=CONTAR.SI([Canal];"Online")'), 2);
  assert.equal(measure('=CONTAR.SI([Ventas];">=1000")'), 2);
  assert.equal(measure('=CONTAR.SI([Región];"And*")'), 2);
  assert.equal(measure('=CONTAR.SI([Región];"<>Andina")'), 3);
  assert.equal(measure('=SUMAR.SI([Canal];"Online";[Ventas])'), 3000);
  assert.equal(measure('=SUMAR.SI.CONJUNTO([Ventas];[Canal];"Online";[Región];"Andina")'), 3000);
  assert.equal(measure('=CONTAR.SI.CONJUNTO([Canal];"Tienda";[Ventas];">100")'), 1);
  assert.equal(measure('=SUMAPRODUCTO([Unidades];[Costo])'), 6000 + 2250 + 4400);
  assert.equal(measure('=DIVIDIR(SUMA([Ventas]-[Costo]);SUMA([Ventas]))', [3]), null, 'grupo sin ventas no falla');
  assert.equal(measure('=SUMA(SI([Canal]="Online";[Ventas];0))'), 3000, 'SI vectorial dentro de una agregación');
  assert.equal(measure('=SI(SUMA([Ventas])>3000;"Meta cumplida";"Bajo meta")'), 'Meta cumplida');
});

test('medidas que usan otras medidas', () => {
  const measures = new Map([['ventas totales', parseFormula('=SUMA([Ventas])')], ['costo total', parseFormula('=SUMA([Costo])')]]);
  assert.equal(measure('=([Ventas totales]-[Costo total])/[Ventas totales]', [0, 2], { measures }), (3000 - 1700) / 3000);
  const loop = new Map([['a', parseFormula('=[b]+1')], ['b', parseFormula('=[a]+1')]]);
  throwsMsg(() => compile('=[a]', { columns, kind: 'measure', measures: loop }), /a sí misma/);
});

test('una medida exige agregar las columnas', () => {
  throwsMsg(() => compile('=[Ventas]*2', { columns, kind: 'measure' }), /dentro de una agregación/);
});

test('funciones propias', () => {
  const margen = compileUdf({ name: 'MARGEN', params: ['venta', 'costo'], body: '=DIVIDIR(venta-costo;venta;0)' });
  const udfs = new Map([[margen.key, margen]]);
  assert.equal(row('=MARGEN([Ventas];[Costo])', rows[0], { udfs }), 0.4);
  assert.equal(row('=margen([Ventas];[Costo])', rows[3], { udfs }), 0);
  // Una función propia puede usar otra
  const pct = compileUdf({ name: 'MARGEN.PCT', params: ['v', 'c'], body: '=REDONDEAR(MARGEN(v;c)*100;1)&"%"' }, udfs);
  udfs.set(pct.key, pct);
  assert.equal(row('=MARGEN.PCT([Ventas];[Costo])', rows[1], { udfs }), '10%');
  // Dentro de medidas
  assert.equal(measure('=MARGEN(SUMA([Ventas]);SUMA([Costo]))', [0, 2], { udfs }), 1300 / 3000);
  throwsMsg(() => compileUdf({ name: 'SUMA', params: ['x'], body: '=x' }), /ya es una función/);
  throwsMsg(() => compileUdf({ name: 'MALA', params: ['x'], body: '=[Ventas]*x' }), /solo usan sus parámetros/);
  throwsMsg(() => compileUdf({ name: 'OTRA', params: ['x'], body: '=x*y' }), /no es un parámetro/);
  throwsMsg(() => compileUdf({ name: 'DOBLE', params: ['x', 'x'], body: '=x*2' }), /repetido/);
  throwsMsg(() => row('=MARGEN([Ventas])', rows[0], { udfs }), /recibe 2 argumentos/);
});

test('mensajes de error claros', () => {
  throwsMsg(() => compile('=[Ventass]+1', { columns, kind: 'column' }), /No existe la columna \[Ventass\]/);
  throwsMsg(() => compile('=Ventas+1', { columns, kind: 'column' }), /entre corchetes/);
  throwsMsg(() => compile('=SI([Ventas]>1;"a"', { columns, kind: 'column' }), /paréntesis/);
  throwsMsg(() => compile('=FOO(1)', { columns, kind: 'column' }), /no existe/);
  throwsMsg(() => compile('="abc', { columns, kind: 'column' }), /comillas/);
  throwsMsg(() => compile('=1 2', { columns, kind: 'column' }), /operador/);
  throwsMsg(() => compile('=REDONDEAR()', { columns, kind: 'column' }), /argumento/);
  throwsMsg(() => compile('=', { columns, kind: 'column' }), /Escribe una fórmula/);
  throwsMsg(() => compile('=1+' + '('.repeat(80) + '1' + ')'.repeat(80), { columns, kind: 'column' }), /niveles/);
  throwsMsg(() => compile('=' + '1+'.repeat(1200) + '1', { columns, kind: 'column' }), /demasiado larga/);
});

test('seguridad: no se ejecuta código', () => {
  // Nada de esto debe ejecutar JavaScript ni acceder a globales
  globalThis.__pwned = false;
  throwsMsg(() => compile('=constructor("globalThis.__pwned=true")()', { columns, kind: 'column' }), /no existe|No esperaba|operador/);
  throwsMsg(() => compile('=__proto__', { columns, kind: 'column' }), /corchetes/);
  throwsMsg(() => compile('=TOSTRING(1)', { columns, kind: 'column' }), /no existe/);
  throwsMsg(() => compile('=HASOWNPROPERTY(1)', { columns, kind: 'column' }), /no existe/);
  assert.throws(() => compile('=[Ventas];alert(1)', { columns, kind: 'column' }));
  assert.equal(globalThis.__pwned, false);
  assert.equal(row('="<img src=x onerror=alert(1)>"'), '<img src=x onerror=alert(1)>', 'el texto se devuelve como texto');
});

test('rendimiento razonable', () => {
  const big = Array.from({ length: 100000 }, (_, i) => [new Date(2025, i % 12, 1), i % 2 ? 'A' : 'B', i, i / 2, i % 7, 'Online']);
  const { ast } = compile('=SI([Ventas]>50000;REDONDEAR(([Ventas]-[Costo])/[Ventas];2);"bajo")&" - "&AÑO([Fecha])', { columns, kind: 'column' });
  const t0 = Date.now();
  for (const r of big) evalRow(ast, r);
  const m = compile('=SUMA([Ventas]-[Costo])/CONTAR.UNICOS([Región])', { columns, kind: 'measure' }).ast;
  evalMeasure(m, big);
  assert.ok(Date.now() - t0 < 1500, `tardó ${Date.now() - t0} ms`);
  assert.ok(!isErr(evalMeasure(m, big)));
});
