import React, { useEffect, useState } from 'react';
import { Modal } from './ui.jsx';
import { listMicrosoftWorkbooks, googleEnabled, microsoftEnabled } from '../lib/connectors.js';

const GoogleMark = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#0F9D58" d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" /><path fill="#87CEAC" d="M14.5 2v5.5H20L14.5 2Z" /><path fill="#fff" d="M7.5 11h9v7h-9v-7Zm1.2 1.2v1.7h2.7v-1.7H8.7Zm3.9 0v1.7h2.7v-1.7h-2.7Zm-3.9 2.9v1.7h2.7v-1.7H8.7Zm3.9 0v1.7h2.7v-1.7h-2.7Z" /></svg>
);
const ExcelMark = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" fill="#107C41" /><path fill="#fff" d="m8 7.5 2.4 4.5L8 16.5h1.9l1.5-3 1.5 3h1.9L12.4 12l2.4-4.5h-1.9l-1.5 2.9-1.5-2.9H8Z" /></svg>
);

/** Botones para conectar hojas en línea (solo aparecen si la conexión está configurada). */
export function ConnectButtons({ onConnect, locked, busy }) {
  const g = googleEnabled(), m = microsoftEnabled();
  if (!g && !m) return null;
  return (
    <div className="connect">
      <span>O conecta una hoja en línea{locked && <span className="pro-tag">Pro</span>}</span>
      <div className="connect-list">
        {g && <button type="button" className="btn btn-ghost" onClick={() => onConnect('google')} disabled={busy}><GoogleMark /> Google Sheets</button>}
        {m && <button type="button" className="btn btn-ghost" onClick={() => onConnect('microsoft')} disabled={busy}><ExcelMark /> Excel en línea</button>}
      </div>
    </div>
  );
}

const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);
const fmtDate = (d) => { try { return new Date(d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };

/** Busca y elige un libro de Excel en OneDrive o SharePoint. */
export function MicrosoftFilesModal({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const [files, setFiles] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const search = async (term) => {
    setLoading(true); setError('');
    try { setFiles(await listMicrosoftWorkbooks(term)); } catch (e) { setError(e.message); if (!files) setFiles([]); } finally { setLoading(false); }
  };
  useEffect(() => { search(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Elige un libro de Excel" onClose={onClose}>
      <div className="stack">
        <form className="share-form ms-search" onSubmit={(e) => { e.preventDefault(); search(q); }}>
          <input className="input" type="search" placeholder="Buscar por nombre en OneDrive y SharePoint" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar libro" />
          <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>{loading ? 'Buscando…' : 'Buscar'}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {files === null && !error && <p className="muted small">Conectando con Microsoft…</p>}
        {files?.length === 0 && !loading && !error && <p className="muted small">No encontramos libros de Excel con ese nombre.</p>}
        {files?.length > 0 && (
          <ul className="proj-list ms-files">
            {files.map((f) => (
              <li key={`${f.driveId}-${f.id}`}>
                <button type="button" className="proj-open" onClick={() => onPick(f)}>
                  <span className="proj-name"><ExcelMark /> {f.name}</span>
                  <span className="muted small">{[f.where, f.size ? fmtSize(f.size) : '', f.modified ? `modificado ${fmtDate(f.modified)}` : ''].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">DataLite solo lee el archivo que elijas, directo desde Microsoft a tu navegador. No guardamos tu acceso.</p>
      </div>
    </Modal>
  );
}
