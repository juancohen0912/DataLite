import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readFile, buildTable, MAX_FILE_MB } from './lib/data.js';
import { SAMPLES, makeSample } from './lib/samples.js';
import { Dashboard } from './app/Dashboard.jsx';
import { track, useToast } from './app/ui.jsx';
import { ScheduleModal } from './app/Schedules.jsx';
import { AccountSlot, LoginModal, ConsentModal, ProModal, NameModal, ProjectsModal, ShareModal, PaymentResult, EmpresaModal, AdminTrialsModal } from './app/Cloud.jsx';
import { ConnectButtons, MicrosoftFilesModal } from './app/Connect.jsx';
import { TemplateList, TemplateModal } from './app/Templates.jsx';
import { templateState, templateAoa } from './app/templates.js';
import { pickGoogleSheet, fetchSource, sourceLabel } from './lib/connectors.js';
import { cloudEnabled, currentSession, handleAuthCallback, rpc, signOut, packTable, uploadData, downloadData, deleteData, CloudError } from './lib/cloud.js';

// ---------------------------------------------------------------- Carga

function Dropzone({ onFile, onSample, onConnect, onTemplate, locked, busy, error }) {
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const cols = ['A', 'B', 'C', 'D', 'E', 'F'];
  return (
    <div
      className={`sheet${over ? ' is-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
    >
      <div className="sheet-grid" aria-hidden="true">
        <span className="corner" />
        {cols.map((c) => <span key={c} className="col-h">{c}</span>)}
        {Array.from({ length: 9 }).map((_, r) => (
          <React.Fragment key={r}>
            <span className="row-h">{r + 1}</span>
            {cols.map((c) => <span key={c} className="cell" />)}
          </React.Fragment>
        ))}
        <span className="selection" />
      </div>
      <div className="sheet-body">
        <p className="sheet-title">{busy ? 'Leyendo tu archivo…' : 'Suelta aquí tu Excel o CSV'}</p>
        <p className="sheet-sub">o elige uno desde tu equipo. .xlsx, .ods y .csv hasta {MAX_FILE_MB} MB.</p>
        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy}>Elegir archivo</button>
          <input ref={input} type="file" hidden accept=".xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        </div>
        {onConnect && <ConnectButtons onConnect={onConnect} locked={locked} busy={busy} />}
        {onTemplate && <TemplateList onOpen={onTemplate} busy={busy} />}
        <div className="samples">
          <span>¿Sin archivo a la mano? Prueba con un ejemplo:</span>
          <div className="sample-list">
            {SAMPLES.map((s) => (
              <button key={s.id} type="button" className="sample" onClick={() => onSample(s.id)} disabled={busy}>
                <strong>{s.label}</strong><small>{s.hint}</small>
              </button>
            ))}
          </div>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="privacy-note">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1 3 3v4c0 3.3 2.1 6.3 5 7 2.9-.7 5-3.7 5-7V3L8 1Zm-1 9.4L4.8 8.2l1-1L7 8.4l3.2-3.2 1 1L7 10.4Z" /></svg>
          Tu archivo se procesa en tu navegador. No lo subimos a ningún servidor.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- App

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Perfil de columnas para datos guardados (los tipos vienen del proyecto). */
function profileSaved(columns, rows) {
  return columns.map((c, i) => {
    const set = new Set();
    let filled = 0;
    for (const r of rows) { const v = r[i]; set.add(v instanceof Date ? v.getTime() : v); if (v !== null && v !== undefined && v !== '') filled++; }
    return { name: c.name, type: c.type, unique: set.size, filled, nulls: rows.length - filled };
  });
}

function App() {
  const [ds, setDs] = useState(null);
  const [initial, setInitial] = useState(null);
  const [project, setProject] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [account, setAccount] = useState({ session: currentSession(), status: null });
  const [modal, setModal] = useState(null); // { type, reason?, then? }
  const [saving, setSaving] = useState(false);
  const [toast, showToast] = useToast();
  const top = useRef(null);
  const pending = useRef(null);
  const isPago = location.pathname === '/pago';
  const cloudOn = cloudEnabled();

  useEffect(() => {
    document.body.classList.toggle('has-data', !!ds || isPago);
    if (ds) document.getElementById('demo-video')?.pause();
    if (ds) top.current?.scrollIntoView({ block: 'start' });
  }, [!!ds]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshAccount() {
    const session = currentSession();
    if (!session) { setAccount({ session: null, status: null }); try { localStorage.setItem('dl-plan', 'free'); } catch { /* nada */ } return null; }
    try {
      const status = await rpc('dl_account_status');
      setAccount({ session: currentSession(), status });
      try { localStorage.setItem('dl-plan', status?.pro ? 'pro' : 'free'); } catch { /* nada */ }
      document.documentElement.classList.toggle('is-pro', !!status?.pro);
      return status;
    } catch (e) {
      if (e.kind === 'login') setAccount({ session: null, status: null });
      return null;
    }
  }

  // Inicio: enlace del correo, cuenta, proyecto en la URL o ejemplo
  useEffect(() => {
    (async () => {
      if (cloudOn) {
        try {
          const back = await handleAuthCallback();
          if (back) { history.replaceState(null, '', back); track('login_ok'); }
        } catch (e) { setModal({ type: 'login', reason: e.message }); }
        await refreshAccount();
      }
      const q = new URLSearchParams(location.search);
      const pid = q.get('p');
      if (cloudOn && pid && UUID.test(pid)) openProject(pid);
      const id = q.get('ejemplo');
      if (!pid && id && SAMPLES.some((x) => x.id === id)) onSample(id);
    })();
    // Si la persona abre el enlace del correo en otra pestaña, esta pestaña también queda con la sesión
    const onStorage = (e) => { if (e.key === 'dl-session-v1') { refreshAccount().then(() => { if (currentSession()) setModal((m) => (m?.type === 'login' ? null : m)); }); } };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Botones del sitio (sección Planes) que abren el pago de Pro: se enlazan por data-open-pro.
  const openPro = useRef(null);
  openPro.current = async () => { track('pro_click'); if (await gate('account', 'Inicia sesión para activar DataLite Pro.')) setModal({ type: 'pro' }); };
  const openEmpresa = useRef(null);
  openEmpresa.current = async () => { track('empresa_click'); if (await gate('account', 'Inicia sesión con tu correo de trabajo para crear el plan de tu empresa.')) setModal({ type: 'empresa' }); };
  useEffect(() => {
    const onClick = (e) => {
      if (!cloudOn) return;
      const emp = e.target.closest?.('[data-open-empresa]');
      if (emp) { e.preventDefault(); openEmpresa.current(); return; }
      const b = e.target.closest?.('[data-open-pro]'); if (!b) return; e.preventDefault(); openPro.current();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Puertas: cuenta → consentimiento → plan Pro. Devuelve true si se puede continuar ya.
  async function gate(level, reason, then) {
    if (!currentSession()) { pending.current = null; setModal({ type: 'login', reason }); return false; }
    const status = account.status || (await refreshAccount());
    if (!status) { setModal({ type: 'login', reason }); return false; }
    if (!status.consent_version) { pending.current = then; setModal({ type: 'consent', level, reason }); return false; }
    if (level === 'pro' && !status.pro) { setModal({ type: 'pro', reason }); return false; }
    return true;
  }

  function load(fileName, sheets, sheetIdx = 0, source = null, initialState = null) {
    const t = buildTable(sheets[sheetIdx].aoa);
    if (!t.rows.length || !t.columns.length) throw new Error('No encontramos filas con datos. Revisa que la primera fila tenga los encabezados.');
    setProject(null); setInitial(typeof initialState === 'function' ? initialState(t.columns) : initialState);
    if (new URLSearchParams(location.search).get('p')) history.replaceState(null, '', '/');
    setDs({ fileName, sheets, sheetIdx, ...t, source, key: `${fileName}-${sheetIdx}-${Date.now()}` });
  }

  // ---------- Hojas en línea (Google Sheets y Excel en OneDrive/SharePoint), solo Pro y Empresa
  const stateRef = useRef(null);
  const biggest = (sheets) => sheets.reduce((best, s, i) => (s.aoa.length > sheets[best].aoa.length ? i : best), 0);
  async function onConnect(type) {
    setError('');
    if (!(await gate('pro', 'Conectar hojas de Google Sheets y Excel en línea es parte de DataLite Pro y Empresa.'))) return;
    if (type === 'microsoft') { setModal({ type: 'msfiles' }); return; }
    try {
      const src = await pickGoogleSheet();
      if (src) await loadSource(src);
    } catch (e) { setError(e.message); }
  }
  async function loadSource(src) {
    setBusy(true); setError(''); setModal(null);
    try {
      const file = await fetchSource(src);
      const { sheets } = await readFile(file);
      load(src.name.replace(/\.(xlsx|xlsm|csv)$/i, ''), sheets, biggest(sheets), src);
      track('hoja_conectada', { tipo: src.type });
    } catch (e) { setError(e.message || 'No pudimos leer la hoja.'); } finally { setBusy(false); }
  }
  // Vuelve a leer la hoja conectada y conserva visuales, fórmulas, filtros y el proyecto abierto.
  async function onRefresh() {
    const src = ds?.source;
    if (!src) return;
    if (!(await gate('pro', 'Actualizar datos desde Google Sheets o Excel en línea es parte de DataLite Pro y Empresa.'))) return;
    setBusy(true);
    try {
      const file = await fetchSource(src);
      const { sheets } = await readFile(file);
      const want = ds.sheets?.[ds.sheetIdx]?.name || src.sheet;
      let idx = sheets.findIndex((s) => s.name === want);
      if (idx < 0) idx = biggest(sheets);
      const t = buildTable(sheets[idx].aoa);
      if (!t.rows.length || !t.columns.length) throw new Error('La hoja ya no tiene filas con datos.');
      setInitial(stateRef.current ? stateRef.current() : initial);
      setDs({ fileName: ds.fileName, sheets, sheetIdx: idx, ...t, source: src, key: `${src.id}-${idx}-${Date.now()}` });
      track('hoja_actualizada', { tipo: src.type });
      showToast(`Datos actualizados desde ${sourceLabel(src)}: ${t.rows.length.toLocaleString('es-CO')} filas.${project && project.role !== 'viewer' ? ' Guarda para que tus invitados vean lo nuevo.' : ''}`);
    } catch (e) {
      showToast(e.message || 'No pudimos actualizar los datos.', 'error');
    } finally { setBusy(false); }
  }

  async function onFile(file) {
    setBusy(true); setError('');
    try {
      const { sheets } = await readFile(file);
      // Elegir la hoja con más filas por defecto
      const idx = sheets.reduce((best, s, i) => (s.aoa.length > sheets[best].aoa.length ? i : best), 0);
      load(file.name.replace(/\.[^.]+$/, ''), sheets, idx);
      track('archivo_cargado', { ext: file.name.split('.').pop().toLowerCase() });
    } catch (e) {
      setError(e.message || 'No pudimos leer el archivo.');
    } finally { setBusy(false); }
  }

  // Plantillas: con datos de ejemplo o con el archivo del usuario y su asignación de columnas
  function onUseTemplate({ tpl, sample, fileName, sheets, sheetIdx, map }) {
    setModal(null); setError('');
    try {
      if (sample) {
        const aoa = templateAoa(tpl);
        const all = Object.fromEntries(tpl.columns.map((c, i) => [c.key, i]));
        load(`Ejemplo de ${tpl.name.toLowerCase()}`, [{ name: tpl.name, aoa }], 0, null, (cols) => templateState(tpl, all, cols));
      } else {
        load(fileName, sheets, sheetIdx, null, (cols) => templateState(tpl, map, cols));
      }
    } catch (e) { setError(e.message); }
  }

  function onSample(id) {
    setError('');
    const s = makeSample(id);
    load(s.name, [{ name: s.name, aoa: s.aoa }]);
    track('ejemplo_cargado', { id });
  }

  // ---------- Proyectos en la nube
  async function openProject(id) {
    if (!currentSession()) { setModal({ type: 'login', reason: 'Inicia sesión con el correo al que te compartieron el proyecto para abrirlo.' }); return; }
    setBusy(true); setError(''); setModal(null);
    try {
      const meta = await rpc('dl_get_project', { p_id: id });
      if (!meta) throw new CloudError('Este proyecto no existe o no tienes acceso con tu correo.');
      if (!meta.has_data) throw new CloudError('Este proyecto todavía no tiene datos guardados.');
      const data = await downloadData(id);
      const columns = profileSaved(data.columns, data.rows);
      const key = `p-${id}-${meta.version}-${Date.now()}`;
      setInitial(meta.state || null);
      setProject({ ...meta, dataKey: key });
      setDs({ fileName: data.fileName || meta.name, sheets: null, sheetIdx: 0, columns, rows: data.rows, truncated: data.truncated, source: meta.state?.source || null, key });
      history.replaceState(null, '', `/?p=${id}`);
      track('proyecto_abierto', { rol: meta.role });
    } catch (e) {
      setError(e.message); showToast(e.message, 'error');
      if (e.kind === 'login') setModal({ type: 'login', reason: e.message });
    } finally { setBusy(false); }
  }

  async function uploadCurrent(id) {
    const blob = await packTable(ds);
    if (blob.size > 25 * 1048576) throw new CloudError('Los datos comprimidos superan 25 MB, el máximo por proyecto.', 'limit');
    await uploadData(id, blob);
    return blob.size;
  }

  async function createProject(name, state, inOrg = false) {
    const { id } = await rpc('dl_create_project', { p_name: name, p_state: state });
    if (inOrg) await rpc('dl_set_project_org', { p_id: id, p_in_org: true });
    const bytes = await uploadCurrent(id);
    const version = await rpc('dl_save_project', { p_id: id, p_name: name, p_state: state, p_expected_version: 1, p_has_data: true, p_data_bytes: bytes, p_row_count: ds.rows.length });
    const meta = { id, name, version, role: 'owner', can_edit: true, owner_email: account.status?.email, has_data: true, dataKey: ds.key };
    setProject(meta);
    history.replaceState(null, '', `/?p=${id}`);
    refreshAccount();
    track('proyecto_creado');
    return meta;
  }

  // Nombre del espacio de la empresa vigente (para ofrecer guardar ahí)
  const orgSpace = () => (account.status?.org?.active ? account.status.org.name : null);

  async function onSave(state, { asNew } = {}) {
    if (!(await gate('pro', 'Guardar tableros en la nube es parte de DataLite Pro.'))) return false;
    if (!project || asNew) {
      return new Promise((resolve) => {
        setModal({
          type: 'name', initial: asNew ? `${project?.name || ds.fileName} (copia)` : ds.fileName,
          orgName: orgSpace(),
          submit: async (name, inOrg) => { await createProject(name, state, inOrg); setModal(null); showToast('Proyecto guardado en tu cuenta.'); resolve(true); },
          cancel: () => resolve(false),
        });
      });
    }
    setSaving(true);
    try {
      let bytes = null;
      if (project.dataKey !== ds.key) bytes = await uploadCurrent(project.id);
      const version = await rpc('dl_save_project', { p_id: project.id, p_name: project.name, p_state: state, p_expected_version: project.version, p_has_data: true, p_data_bytes: bytes, p_row_count: ds.rows.length });
      setProject((p) => ({ ...p, version, dataKey: ds.key }));
      showToast('Cambios guardados.');
      return true;
    } catch (e) {
      if (e.kind === 'conflict') showToast(e.message, 'warn');
      else if (e.kind === 'owner_not_pro') showToast('El plan Pro del dueño venció: el proyecto quedó en solo lectura hasta que lo renueve.', 'warn');
      else if (e.kind === 'pro') setModal({ type: 'pro', reason: e.message });
      else showToast(e.message, 'error');
      return false;
    } finally { setSaving(false); }
  }

  async function onShare(getState) {
    if (!(await gate('pro', 'Compartir tableros con tu equipo es parte de DataLite Pro.'))) return;
    if (!project) {
      setModal({ type: 'name', title: 'Guarda el proyecto para compartirlo', initial: ds.fileName, orgName: orgSpace(), submit: async (name, inOrg) => { const meta = await createProject(name, getState(), inOrg); setModal({ type: 'share', project: meta }); } });
      return;
    }
    setModal({ type: 'share', project });
  }

  async function onRequestEdit() {
    try {
      const ok = await rpc('dl_request_edit', { p_id: project.id });
      setProject((p) => ({ ...p, edit_requested: true }));
      showToast(ok ? `Listo. ${project.owner_email} verá tu solicitud al abrir DataLite.` : 'Ya habías pedido permiso; el dueño aún no responde.');
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function onDeleteProject(id) {
    try {
      await deleteData(id);
      await rpc('dl_delete_project', { p_id: id });
      if (project?.id === id) { setProject(null); setDs(null); history.replaceState(null, '', '/'); }
      refreshAccount();
      showToast('Proyecto borrado.');
    } catch (e) { showToast(e.message, 'error'); }
  }

  const openProjects = async () => { if (await gate('account', 'Inicia sesión para ver tus proyectos.')) setModal({ type: 'projects' }); };

  // ---------- Descargas: analizar no pide cuenta; descargar sí. Gratis: límite mensual contado en la base.
  async function onExport(kind) {
    if (!(await gate('account', 'Crea tu cuenta gratis para descargar: incluye 3 descargas al mes. Analizar sigue sin cuenta.'))) {
      track('descarga_pide_cuenta', { tipo: kind });
      return false;
    }
    try {
      const r = await rpc('dl_use_export', { p_kind: kind });
      setAccount((a) => (a.status ? { ...a, status: { ...a.status, exports: { used: r.used, limit: r.limit } } } : a));
      if (r.allowed) return true;
      track('limite_descargas');
      setModal({ type: 'pro', reason: `Usaste tus ${r.limit} descargas gratis de este mes. Con Pro descargas sin límite y sin marca de agua.` });
      return false;
    } catch (e) {
      if (e.status === 404) return true; // la base todavía no tiene el límite (migración pendiente): no bloquear
      if (e.kind === 'login') setModal({ type: 'login', reason: e.message });
      else if (e.kind === 'consent') setModal({ type: 'consent', level: 'account', reason: e.message });
      else showToast(e.message, 'error');
      return false;
    }
  }

  // Prueba de Pro (una por cuenta). Los errores los muestra el modal.
  async function onTrial() {
    const r = await rpc('dl_start_trial');
    await refreshAccount();
    setModal(null);
    track('prueba_pro');
    showToast(`Tu prueba de DataLite Pro quedó activa hasta el ${new Date(r.ends_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}.`);
  }

  const cloud = cloudOn ? {
    project, role: project?.role || (ds ? 'owner' : null), pro: !!account.status?.pro, saving,
    editRequested: !!project?.edit_requested,
    signedIn: !!account.session, exports: account.status?.exports || null, trialAvailable: account.status?.trial?.available ?? !account.session,
    onSchedule: async (info) => { if (await gate('pro', 'Los reportes programados y las alertas son del plan Pro o Empresa.')) setModal({ type: 'schedule', ...info }); },
    onSave, onShare, onOpenProjects: openProjects, onRequestEdit, onExport, onPro: () => openPro.current(),
    registerGetState: (fn) => { stateRef.current = fn; },
  } : null;
  if (cloud && project && !project.can_edit && project.role !== 'viewer') cloud.role = 'viewer';

  return (
    <div ref={top} className="app">
      {isPago
        ? <PaymentResult onLogin={() => setModal({ type: 'login', reason: 'Inicia sesión con el correo de tu cuenta para confirmar el pago.' })} onDone={refreshAccount} />
        : ds
          ? <Dashboard key={ds.key} ds={ds} initial={initial} cloud={cloud} onRefresh={cloudOn ? onRefresh : null} onReset={() => { setDs(null); setProject(null); setInitial(null); history.replaceState(null, '', '/'); }} onSheet={(i) => { try { load(ds.fileName, ds.sheets, i, ds.source); } catch (e) { alert(e.message); } }} />
          : <Dropzone onFile={onFile} onSample={onSample} onTemplate={(tpl) => setModal({ type: 'template', tpl })} onConnect={cloudOn ? onConnect : null} locked={!account.status?.pro} busy={busy} error={error} />}

      {cloudOn && <AccountSlot account={account} onAdmin={() => setModal({ type: 'admin' })} onLogin={() => setModal({ type: 'login' })} onOpenProjects={openProjects} onEmpresa={() => openEmpresa.current()} onPro={async () => { if (await gate('account', 'Inicia sesión para activar DataLite Pro.')) setModal({ type: 'pro' }); }} onSignOut={async () => { await signOut(); setAccount({ session: null, status: null }); showToast('Cerraste sesión.'); }} />}
      {modal?.type === 'login' && <LoginModal reason={modal.reason} onClose={() => setModal(null)} />}
      {modal?.type === 'consent' && <ConsentModal onClose={() => setModal(null)} onDone={async () => { const st = await refreshAccount(); const then = pending.current; pending.current = null; setModal(modal.level === 'pro' && !st?.pro ? { type: 'pro', reason: modal.reason } : null); then?.(); }} />}
      {modal?.type === 'pro' && <ProModal reason={modal.reason} account={account} onTrial={onTrial} onClose={() => setModal(null)} />}
      {modal?.type === 'empresa' && <EmpresaModal account={account} onChanged={refreshAccount} onClose={() => setModal(null)} />}
      {modal?.type === 'name' && <NameModal title={modal.title} initial={modal.initial} orgName={modal.orgName} onSubmit={modal.submit} onClose={() => { modal.cancel?.(); setModal(null); }} />}
      {modal?.type === 'projects' && <ProjectsModal currentId={project?.id} onOpen={openProject} onDelete={onDeleteProject} onClose={() => setModal(null)} />}
      {modal?.type === 'template' && <TemplateModal tpl={modal.tpl} onUse={onUseTemplate} onClose={() => setModal(null)} />}
      {modal?.type === 'msfiles' && <MicrosoftFilesModal onPick={(f) => loadSource(f)} onClose={() => setModal(null)} />}
      {modal?.type === 'schedule' && project && <ScheduleModal project={project} columns={modal.columns} measures={modal.measures} source={modal.source} ownerEmail={account.status?.email} onClose={() => setModal(null)} />}
      {modal?.type === 'admin' && account.status?.admin && <AdminTrialsModal onClose={() => { setModal(null); refreshAccount(); }} />}
      {modal?.type === 'share' && <ShareModal project={modal.project} account={account} onClose={() => { setModal(null); refreshAccount(); }} />}
      {toast}
    </div>
  );
}

// ---------------------------------------------------------------- Video de demostración

function initDemo() {
  const fig = document.querySelector('.demo');
  const video = document.getElementById('demo-video');
  if (!fig || !video) return;
  const toggle = fig.querySelector('.demo-toggle');
  const bar = fig.querySelector('.demo-progress i');
  const steps = [...fig.querySelectorAll('.demo-steps button')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let userPaused = false, tracked = false;

  const sync = () => {
    const playing = !video.paused;
    fig.classList.toggle('is-playing', playing);
    toggle.setAttribute('aria-label', playing ? 'Pausar la demostración' : 'Reproducir la demostración');
  };
  const play = () => video.play().catch(() => {});
  const userPlay = () => { userPaused = false; play(); if (!tracked) { tracked = true; track('demo_video'); } };
  const togglePlay = () => { if (video.paused) userPlay(); else { userPaused = true; video.pause(); } };

  video.addEventListener('play', sync);
  video.addEventListener('pause', sync);
  video.addEventListener('click', togglePlay);
  toggle.addEventListener('click', togglePlay);
  fig.querySelector('.demo-full')?.addEventListener('click', () => {
    const el = video.requestFullscreen ? video : video.webkitEnterFullscreen ? video : null;
    if (!el) return;
    userPlay();
    if (video.requestFullscreen) video.requestFullscreen().catch(() => {}); else video.webkitEnterFullscreen();
    track('demo_pantalla_completa');
  });
  video.addEventListener('timeupdate', () => {
    const t = video.currentTime;
    if (video.duration) bar.style.width = `${(t / video.duration) * 100}%`;
    let active = -1;
    steps.forEach((s, i) => { if (t >= +s.dataset.t) active = i; });
    if (t >= 31) active = -1; // tarjeta del autor
    steps.forEach((s, i) => s.classList.toggle('on', i === active));
  });
  steps.forEach((s) => s.addEventListener('click', () => { video.currentTime = +s.dataset.t; userPlay(); }));

  // Reproduce en silencio solo cuando está a la vista y si la persona no prefiere menos movimiento.
  if (!reduced && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !userPaused && !document.body.classList.contains('has-data')) play();
      else if (!e.isIntersecting) video.pause();
    }, { threshold: 0.5 }).observe(video);
  }
}
initDemo();

const mount = document.getElementById('tool');
if (mount) {
  mount.innerHTML = '';
  createRoot(mount).render(<App />);
}
