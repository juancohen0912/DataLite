import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { sendMagicLink, rpc, startCheckout, confirmPayment, CONSENT_VERSION, CloudError } from '../lib/cloud.js';
import { Modal, Icon, Field, Menu, track } from './ui.jsx';

const PRICE = '$19.900';
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return fmtDate(iso);
};

// ------------------------------------------------------------------ Botón de cuenta (en el encabezado)

/** «Plan gratis · 1 de 3 descargas este mes» */
const planHint = (status) => (status?.exports ? `Plan gratis · ${status.exports.used} de ${status.exports.limit} descargas este mes` : 'Plan gratis');

export function AccountSlot({ account, onLogin, onOpenProjects, onPro, onSignOut }) {
  const [el, setEl] = useState(null);
  useEffect(() => { setEl(document.getElementById('account-slot')); }, []);
  if (!el) return null;
  const node = !account.session ? (
    <button type="button" className="nav-login" onClick={onLogin} aria-label="Iniciar sesión"><Icon name="user" /><span className="nav-user-txt">Iniciar sesión</span></button>
  ) : (
    <Menu label={<span className="nav-user"><span className="avatar" aria-hidden="true">{(account.status?.email || account.session.email || '?')[0].toUpperCase()}</span><span className="nav-user-txt">{account.status?.pro ? 'Pro' : 'Mi cuenta'}</span>{account.status?.pending_requests > 0 && <span className="count" title="Solicitudes de edición">{account.status.pending_requests}</span>}</span>}
      buttonClass="nav-login" items={[
        { label: account.status?.email || account.session.email, hint: account.status?.trial?.active ? `Prueba de Pro hasta el ${fmtDate(account.status.plan?.period_end)}` : account.status?.pro ? `DataLite Pro hasta el ${fmtDate(account.status.plan?.period_end)}` : planHint(account.status), onClick: () => {}, disabled: true },
        { label: 'Mis proyectos', onClick: onOpenProjects },
        !account.status?.pro && { label: account.status?.trial?.available ? `Probar Pro gratis ${account.status.trial.days} días` : `Obtener Pro (${PRICE} al mes)`, onClick: onPro },
        account.status?.pro && { label: 'Renovar o extender 30 días', onClick: onPro },
        { label: 'Cerrar sesión', onClick: onSignOut },
      ]} />
  );
  return createPortal(node, el);
}

// ------------------------------------------------------------------ Iniciar sesión

export function LoginModal({ reason, onClose }) {
  const [email, setEmail] = useState('');
  const [accept, setAccept] = useState(false);
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setError('Escribe un correo válido.'); return; }
    if (!accept) { setError('Para crear tu cuenta debes aceptar la política de privacidad y los términos.'); return; }
    setState('sending');
    try { await sendMagicLink(email); setState('sent'); track('login_enlace'); }
    catch (err) { setError(err.message); setState('idle'); }
  }
  return (
    <Modal title={state === 'sent' ? 'Revisa tu correo' : 'Inicia sesión en DataLite'} onClose={onClose}>
      {state === 'sent' ? (
        <div className="stack">
          <p>Te enviamos un enlace de acceso a <b>{email.trim()}</b>. Ábrelo <b>en este mismo navegador</b> para entrar.</p>
          <p className="muted small">Si no llega en un par de minutos, revisa la carpeta de spam o promociones. El enlace vence en una hora.</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setState('idle')}>Usar otro correo</button>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          {reason && <p className="callout-sm">{reason}</p>}
          <p className="muted">Sin contraseñas: te enviamos un enlace al correo. La cuenta es gratis e incluye 3 descargas al mes. Pro se paga solo si quieres descargas ilimitadas, guardar y compartir.</p>
          <Field label="Correo electrónico">
            <input className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" required />
          </Field>
          <label className="check">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
            <span>Acepto la <a href="/privacidad" target="_blank" rel="noopener">política de privacidad</a> y los <a href="/terminos" target="_blank" rel="noopener">términos de uso</a>, y autorizo el tratamiento de mis datos para usar DataLite.</span>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>{state === 'sending' ? 'Enviando…' : 'Enviarme el enlace'}</button>
        </form>
      )}
    </Modal>
  );
}

/** Para cuentas que existían antes (o que no aceptaron aún la política de DataLite). */
export function ConsentModal({ onDone, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function accept() {
    setBusy(true); setError('');
    try { await rpc('dl_accept_terms', { p_version: CONSENT_VERSION }); onDone(); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <Modal title="Antes de guardar en la nube" onClose={onClose} footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Ahora no</button><button type="button" className="btn btn-primary" onClick={accept} disabled={busy}>Acepto</button></>}>
      <div className="stack">
        <p>Para guardar y compartir proyectos, DataLite almacena tus datos en un servidor seguro. Revisa cómo los tratamos en la <a href="/privacidad" target="_blank" rel="noopener">política de privacidad</a> y los <a href="/terminos" target="_blank" rel="noopener">términos de uso</a>.</p>
        <p className="muted small">Solo tú y las personas que invites pueden ver tus proyectos. Puedes borrarlos cuando quieras.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Plan Pro

export function ProModal({ reason, account, onClose, onTrial }) {
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  async function trial() {
    setState('trial'); setError('');
    try { await onTrial(); } catch (e) { setError(e.message); setState('idle'); }
  }
  const trialInfo = account.status?.trial;
  const canTrial = !account.status?.pro && trialInfo?.available && onTrial;
  async function pay() {
    setState('loading'); setError('');
    try { const url = await startCheckout(); track('checkout_inicio'); window.location.assign(url); }
    catch (e) { setError(e.message); setState(e.kind === 'unavailable' ? 'unavailable' : 'idle'); }
  }
  const pro = account.status?.pro;
  return (
    <Modal title={pro ? 'Tu plan DataLite Pro' : 'DataLite Pro'} onClose={onClose}>
      <div className="stack">
        {reason && !pro && <p className="callout-sm">{reason}</p>}
        <p className="price-line"><b>{PRICE}</b> <span className="muted">COP por 30 días · sin renovación automática</span></p>
        <ul className="ticks">
          <li>Guarda hasta {account.status?.limits?.max_projects ?? 50} tableros en la nube, con sus datos y fórmulas</li>
          <li>Compártelos con hasta {account.status?.limits?.max_members ?? 10} personas por proyecto: ver es gratis para ellas</li>
          <li>Tú decides quién puede editar; los demás pueden pedirte permiso</li>
          <li>Descargas ilimitadas, sin marca de agua y sin publicidad</li>
        </ul>
        {pro && <p>Tu plan está activo hasta el <b>{fmtDate(account.status.plan?.period_end)}</b>. Si pagas otra vez, se suman 30 días al final.</p>}
        <p className="muted small">El pago se hace en Wompi (Bancolombia) con tarjeta, PSE, Nequi o Bancolombia. DataLite no recibe ni guarda los datos de tu tarjeta. Si tu plan vence, tus proyectos se conservan y siguen visibles; solo se pausa la edición.</p>
        {state === 'unavailable' && <p className="callout-sm">El pago en línea se está habilitando. Escríbenos desde la página <a href="/acerca">Acerca de</a> y activamos tu plan manualmente.</p>}
        {error && state !== 'unavailable' && <p className="error" role="alert">{error}</p>}
        {canTrial && (
          <div className="trial-box">
            <p><b>Pruébalo gratis {trialInfo.days} días.</b> Sin medios de pago. Al terminar vuelves al plan gratis; tus proyectos quedan guardados en solo lectura.</p>
            <button type="button" className="btn btn-primary" onClick={trial} disabled={state === 'trial' || state === 'loading'}>{state === 'trial' ? 'Activando…' : `Probar ${trialInfo.days} días gratis`}</button>
          </div>
        )}
        <button type="button" className={canTrial ? 'btn btn-ghost' : 'btn btn-primary'} onClick={pay} disabled={state === 'loading' || state === 'trial'}>{state === 'loading' ? 'Abriendo Wompi…' : pro ? 'Extender 30 días' : `Pagar ${PRICE} con Wompi`}</button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Nombre al guardar por primera vez

export function NameModal({ title = 'Guardar proyecto', initial, onSubmit, onClose }) {
  const [name, setName] = useState(initial || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Ponle un nombre al proyecto.'); return; }
    setBusy(true); setError('');
    try { await onSubmit(name.trim().slice(0, 120)); } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Nombre del proyecto"><input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
        <p className="muted small">Se guardan tus datos (la tabla original), las fórmulas, los visuales, los filtros y el tema.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar en la nube'}</button>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ Mis proyectos

export function ProjectsModal({ onOpen, onClose, onDelete, currentId }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const load = () => rpc('dl_list_projects').then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const mine = (list || []).filter((p) => p.role === 'owner');
  const shared = (list || []).filter((p) => p.role !== 'owner');
  const row = (p) => (
    <li key={p.id} className={p.id === currentId ? 'current' : ''}>
      <button type="button" className="proj-open" onClick={() => onOpen(p.id)}>
        <span className="proj-name">{p.name}</span>
        <span className="muted small">{p.role === 'owner' ? `${p.members ? `Compartido con ${p.members} · ` : ''}` : `De ${p.owner_email} · ${p.role === 'editor' ? 'puedes editar' : 'solo lectura'} · `}{(p.row_count || 0).toLocaleString('es-CO')} filas · {ago(p.updated_at)}</span>
      </button>
      {p.requests > 0 && <span className="count" title="Solicitudes de edición pendientes">{p.requests}</span>}
      {p.role === 'owner' && <button type="button" className="icon-btn" aria-label={`Borrar ${p.name}`} onClick={async () => { if (confirm(`¿Borrar «${p.name}»? Esta acción no se puede deshacer.`)) { await onDelete(p.id); load(); } }}><Icon name="trash" /></button>}
    </li>
  );
  return (
    <Modal title="Mis proyectos" onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {!list && !error && <p className="muted">Cargando…</p>}
      {list && !list.length && <p className="muted">Aún no tienes proyectos guardados. Carga un archivo y usa «Guardar» para crear el primero.</p>}
      {mine.length > 0 && <><h3 className="proj-h">Míos</h3><ul className="proj-list">{mine.map(row)}</ul></>}
      {shared.length > 0 && <><h3 className="proj-h">Compartidos conmigo</h3><ul className="proj-list">{shared.map(row)}</ul></>}
    </Modal>
  );
}

// ------------------------------------------------------------------ Compartir y permisos

export function ShareModal({ project, account, onClose }) {
  const [members, setMembers] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/?p=${project.id}`;
  const load = () => rpc('dl_list_members', { p_id: project.id }).then((m) => setMembers(m || [])).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const invite = (e) => { e.preventDefault(); act(async () => { await rpc('dl_share', { p_id: project.id, p_email: email, p_role: role }); setEmail(''); track('compartir', { rol: role }); }); };
  const requests = (members || []).filter((m) => m.edit_requested_at && m.role === 'viewer');
  const max = account.status?.limits?.max_members ?? 10;

  return (
    <Modal title={`Compartir «${project.name}»`} onClose={onClose}>
      <div className="stack">
        <p className="muted small">Las personas que invites verán el tablero gratis, con su propia cuenta. Solo pueden editar si les das permiso de edición.</p>
        <form className="share-form" onSubmit={invite}>
          <input className="input" type="email" placeholder="correo@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Correo de la persona" required />
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Permiso"><option value="viewer">Puede ver</option><option value="editor">Puede editar</option></select>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !email.trim()}>Invitar</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {requests.length > 0 && (
          <div className="requests">
            <h3 className="proj-h">Solicitudes para editar</h3>
            {requests.map((m) => (
              <div key={m.email} className="req-row">
                <span><b>{m.email}</b> pidió permiso para editar</span>
                <span className="req-actions">
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(() => rpc('dl_share', { p_id: project.id, p_email: m.email, p_role: 'editor' }))}>Dar permiso</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => rpc('dl_dismiss_request', { p_id: project.id, p_email: m.email }))}>Rechazar</button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div>
          <h3 className="proj-h">Personas con acceso {members ? `(${members.length} de ${max})` : ''}</h3>
          <ul className="member-list">
            <li><span><b>{account.status?.email}</b> <span className="muted small">(tú, dueño)</span></span></li>
            {(members || []).map((m) => (
              <li key={m.email}>
                <span>{m.email}{!m.has_account && <span className="muted small"> · aún sin cuenta</span>}</span>
                <span className="member-actions">
                  <select value={m.role} disabled={busy} aria-label={`Permiso de ${m.email}`} onChange={(e) => act(() => rpc('dl_share', { p_id: project.id, p_email: m.email, p_role: e.target.value }))}>
                    <option value="viewer">Puede ver</option><option value="editor">Puede editar</option>
                  </select>
                  <button type="button" className="icon-btn" aria-label={`Quitar a ${m.email}`} disabled={busy} onClick={() => act(() => rpc('dl_unshare', { p_id: project.id, p_email: m.email }))}><Icon name="close" /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="share-link">
          <input className="input" readOnly value={link} aria-label="Enlace del proyecto" onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* sin portapapeles */ } }}>{copied ? 'Copiado' : 'Copiar enlace'}</button>
        </div>
        <p className="muted small">El enlace solo funciona para las personas de la lista, después de iniciar sesión con su correo. Envíaselo tú por WhatsApp o correo.</p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Resultado del pago (página /pago)

const PAY_TEXT = {
  APPROVED: ['Pago aprobado', 'Tu plan DataLite Pro quedó activo por 30 días. Ya puedes guardar y compartir tus tableros.'],
  PENDING: ['Pago en proceso', 'Wompi aún está confirmando tu pago (pasa con PSE y Nequi). Tu plan se activará solo apenas se apruebe; vuelve en unos minutos.'],
  DECLINED: ['Pago rechazado', 'Tu banco o Wompi rechazó el pago. No se hizo ningún cobro. Puedes intentar con otro medio.'],
  VOIDED: ['Pago anulado', 'La transacción se anuló y no se hizo ningún cobro.'],
  ERROR: ['Error en el pago', 'Hubo un error procesando el pago. Si ves un cobro, escríbenos y lo revisamos.'],
};

export function PaymentResult({ onLogin, onDone }) {
  const id = new URLSearchParams(location.search).get('id') || '';
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!id) { setError(new CloudError('No llegó el identificador de la transacción.')); return; }
    confirmPayment(id).then((d) => { setStatus(d.status); if (d.status === 'APPROVED') { track('pago_aprobado'); onDone?.(); } }).catch(setError);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [title, body] = error ? ['No pudimos confirmar el pago', error.message] : status ? (PAY_TEXT[status] || PAY_TEXT.PENDING) : ['Confirmando tu pago…', 'Un momento, estamos consultando a Wompi.'];
  return (
    <div className="sheet pay-result" role="status">
      <div className="sheet-body">
        <p className="sheet-title">{title}</p>
        <p>{body}</p>
        <div className="sheet-actions">
          {error?.kind === 'login' && <button type="button" className="btn btn-primary" onClick={onLogin}>Iniciar sesión</button>}
          <a className="btn btn-primary" href="/">Ir a DataLite</a>
          {status === 'PENDING' && <button type="button" className="btn btn-ghost" onClick={() => location.reload()}>Volver a consultar</button>}
        </div>
      </div>
    </div>
  );
}
