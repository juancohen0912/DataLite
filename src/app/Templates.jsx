import React, { useRef, useState } from 'react';
import { Modal, Field, track } from './ui.jsx';
import { TEMPLATES, autoMap, templateAoa } from './templates.js';
import { readFile, buildTable } from '../lib/data.js';
import { downloadBlob, safeName } from '../lib/exporters.js';

const TYPE = { date: 'fecha', number: 'número', text: 'texto' };

/** Fila de plantillas en la pantalla de carga. */
export function TemplateList({ onOpen, busy }) {
  return (
    <div className="samples templates">
      <span>O empieza con una plantilla:</span>
      <div className="template-list">
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" className="template-chip" onClick={() => onOpen(t)} disabled={busy}>
            <span className="emo" aria-hidden="true">{t.emoji}</span>{t.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Ventana de una plantilla: ver con datos de ejemplo, descargar el Excel para llenarlo
 * o usarla con un archivo propio (asignando sus columnas).
 * onUse({ tpl, fileName, sheets, sheetIdx, map }) arma el tablero.
 */
export function TemplateModal({ tpl, onUse, onClose }) {
  const input = useRef(null);
  const [step, setStep] = useState('intro');
  const [file, setFile] = useState(null); // { fileName, sheets, sheetIdx, columns }
  const [map, setMap] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function downloadExample() {
    const { writeWorkbook } = await import('../lib/xlsx.js');
    const aoa = templateAoa(tpl);
    const blob = await writeWorkbook([{ name: tpl.name, aoa, widths: aoa[0].map(() => 20) }]);
    downloadBlob(blob, `Plantilla_DataLite_${safeName(tpl.name)}.xlsx`);
    track('plantilla_descargada', { id: tpl.id });
  }

  async function pickFile(f) {
    setBusy(true); setError('');
    try {
      const { sheets } = await readFile(f);
      const idx = sheets.reduce((best, s, i) => (s.aoa.length > sheets[best].aoa.length ? i : best), 0);
      const t = buildTable(sheets[idx].aoa);
      if (!t.rows.length) throw new Error('No encontramos filas con datos. Revisa que la primera fila tenga los encabezados.');
      setFile({ fileName: f.name.replace(/\.[^.]+$/, ''), sheets, sheetIdx: idx, columns: t.columns });
      setMap(autoMap(tpl, t.columns));
      setStep('map');
    } catch (e) { setError(e.message || 'No pudimos leer el archivo.'); } finally { setBusy(false); }
  }

  const missing = tpl.columns.filter((c) => c.required && (map[c.key] === undefined || map[c.key] < 0));

  return (
    <Modal title={`${tpl.emoji} Plantilla de ${tpl.name.toLowerCase()}`} onClose={onClose}>
      {step === 'intro' ? (
        <div className="stack">
          <p>{tpl.description}</p>
          <div>
            <h3 className="proj-h">Columnas que usa</h3>
            <ul className="tpl-cols">
              {tpl.columns.map((c) => <li key={c.key}><b>{c.label}</b> <span className="muted small">({TYPE[c.type]}{c.required ? '' : ', opcional'})</span></li>)}
            </ul>
            <p className="muted small">No importa si en tu archivo se llaman distinto: al cargarlo eliges cuál es cuál.</p>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="tpl-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Leyendo…' : 'Usar con mi archivo'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { onUse({ tpl, sample: true }); track('plantilla_ejemplo', { id: tpl.id }); }}>Ver con datos de ejemplo</button>
            <button type="button" className="btn btn-link" onClick={downloadExample}>Descargar Excel de ejemplo</button>
          </div>
          <input ref={input} type="file" hidden accept=".xlsx,.xlsm,.ods,.csv,.tsv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ''; }} />
        </div>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!missing.length) { onUse({ tpl, ...file, map }); track('plantilla_usada', { id: tpl.id }); } }}>
          <p className="muted small">Revisa qué columna de <b>{file.fileName}</b> corresponde a cada dato. Las marcamos solas cuando el nombre se parece.</p>
          <div className="tpl-map">
            {tpl.columns.map((c) => (
              <Field key={c.key} label={`${c.label}${c.required ? ' *' : ''}`}>
                <select value={map[c.key] ?? -1} onChange={(e) => setMap({ ...map, [c.key]: +e.target.value })}>
                  <option value={-1}>{c.required ? 'Elige una columna' : 'No la tengo'}</option>
                  {file.columns.map((fc, i) => <option key={i} value={i}>{fc.name}{fc.type !== c.type ? ` (${TYPE[fc.type]})` : ''}</option>)}
                </select>
              </Field>
            ))}
          </div>
          {missing.length > 0 && <p className="hint">Falta elegir: {missing.map((c) => c.label).join(', ')}.</p>}
          <div className="tpl-actions">
            <button type="submit" className="btn btn-primary" disabled={missing.length > 0}>Crear tablero</button>
            <button type="button" className="btn btn-ghost" onClick={() => setStep('intro')}>Volver</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
