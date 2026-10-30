import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { sendMagicLink, rpc, notifyInvite, notifyTrial, startCheckout, confirmPayment, CONSENT_VERSION, CloudError, seatMonthPrice, orgYearTotal } from '../lib/cloud.js';
import { Modal, Icon, Field, Menu, track } from './ui.jsx';

const PRICE = '$19.900';
const cop = (n) => `$${Math.round(n).toLocaleString('es-CO')}`;
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

export function AccountSlot({ account, onLogin, onOpenProjects, onPro, onEmpresa, onSignOut, onAdmin }) {
  const [el, setEl] = useState(null);
  useEffect(() => { setEl(document.getElementById('account-slot')); }, []);
  if (!el) return null;
  const node = !account.session ? (
    <button type="button" className="nav-login" onClick={onLogin} aria-label="Iniciar sesión"><Icon name="user" /><span className="nav-user-txt">Iniciar sesión</span></button>
  ) : (
    <Menu label={<span className="nav-user"><span className="avatar" aria-hidden="true">{(account.status?.email || account.session.email || '?')[0].toUpperCase()}</span><span className="nav-user-txt">{account.status?.pro ? 'Pro' : 'Mi cuenta'}</span>{account.status?.pending_requests > 0 && <span className="count" title="Solicitudes de edición">{account.status.pending_requests}</span>}</span>}
      buttonClass="nav-login" items={[
        { label: account.status?.email || account.session.email, hint: account.status?.org?.active ? `DataLite Empresa · ${account.status.org.name}${account.status?.grant?.kind === 'empresa' ? ` (prueba hasta el ${fmtDate(account.status.grant.ends_at)})` : ''}` : account.status?.grant?.kind === 'pro' && !account.status?.plan ? `Prueba de Pro hasta el ${fmtDate(account.status.grant.ends_at)}` : account.status?.trial?.active ? `Prueba de Pro hasta el ${fmtDate(account.status.plan?.period_end)}` : account.status?.pro ? `DataLite Pro hasta el ${fmtDate(account.status.plan?.period_end)}` : planHint(account.status), onClick: () => {}, disabled: true },
        { label: 'Mis proyectos', onClick: onOpenProjects },
        { label: account.status?.org ? `Mi empresa: ${account.status.org.name}` : 'Plan Empresa para equipos', onClick: onEmpresa },
        !account.status?.pro && { label: account.status?.trial?.available ? `Probar Pro gratis ${account.status.trial.days} días` : `Obtener Pro (${PRICE} al mes)`, onClick: onPro },
        account.status?.pro && !account.status?.org?.active && { label: 'Renovar o extender 30 días', onClick: onPro },
        account.status?.admin && onAdmin && { label: 'Administración: pruebas gratis', onClick: onAdmin },
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
          <li>Conecta Google Sheets y Excel en línea (OneDrive y SharePoint) y actualiza tus tableros con un clic</li>
          <li>Descargas ilimitadas, sin marca de agua y sin publicidad</li>
        </ul>
        {pro && <p>Tu plan está activo hasta el <b>{fmtDate(account.status.plan?.period_end)}</b>. Si pagas otra vez, se suman 30 días al final.</p>}
        <p className="muted small">El pago se hace en Wompi (Bancolombia) con tarjeta, PSE, Nequi o Bancolombia. DataLite no recibe ni guarda los datos de tu tarjeta. Si tu plan vence, tus proyectos se conservan y siguen visibles; solo se pausa la edición.</p>
        {state === 'unavailable' && <p className="callout-sm">El pago en línea se está habilitando. Escríbenos a <a href="mailto:datalitecontact@gmail.com">datalitecontact@gmail.com</a> y activamos tu plan manualmente.</p>}
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

export function NameModal({ title = 'Guardar proyecto', initial, orgName, onSubmit, onClose }) {
  const [name, setName] = useState(initial || '');
  const [inOrg, setInOrg] = useState(!!orgName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Ponle un nombre al proyecto.'); return; }
    setBusy(true); setError('');
    try { await onSubmit(name.trim().slice(0, 120), !!orgName && inOrg); } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Nombre del proyecto"><input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
        {orgName && (
          <label className="check"><input type="checkbox" checked={inOrg} onChange={(e) => setInOrg(e.target.checked)} /> <span>Guardar en el espacio de <b>{orgName}</b>: lo ven y editan todas las personas del equipo</span></label>
        )}
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
  const team = (list || []).filter((p) => p.role !== 'owner' && p.org);
  const shared = (list || []).filter((p) => p.role !== 'owner' && !p.org);
  const row = (p) => (
    <li key={p.id} className={p.id === currentId ? 'current' : ''}>
      <button type="button" className="proj-open" onClick={() => onOpen(p.id)}>
        <span className="proj-name">{p.name}</span>
        <span className="muted small">{p.role === 'owner' ? `${p.org ? 'En el espacio del equipo · ' : ''}${p.members ? `Compartido con ${p.members} · ` : ''}` : `De ${p.owner_email} · ${p.role === 'editor' ? 'puedes editar' : 'solo lectura'} · `}{(p.row_count || 0).toLocaleString('es-CO')} filas · {ago(p.updated_at)}</span>
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
      {team.length > 0 && <><h3 className="proj-h">De mi empresa</h3><ul className="proj-list">{team.map(row)}</ul></>}
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
  const [notice, setNotice] = useState('');
  const link = `${location.origin}/?p=${project.id}`;
  const load = () => rpc('dl_list_members', { p_id: project.id }).then((m) => setMembers(m || [])).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn) => { setBusy(true); setError(''); setNotice(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  // Aviso por correo: si falla, la invitación igual queda hecha y se ofrece copiar el enlace.
  const mail = async (to) => {
    try {
      const r = await notifyInvite(project.id, to);
      setNotice(r.sent ? `Le enviamos un correo a ${to} con el enlace.` : `Ya le avisamos a ${to} hace poco; si no lo encuentra, que revise spam o envíale el enlace.`);
      if (r.sent) track('invitacion_correo');
    } catch (e) {
      setNotice(e.kind === 'unavailable' ? `Invitación lista. Copia el enlace y envíaselo a ${to}.` : `${e.message}`);
    }
  };
  const invite = (e) => {
    e.preventDefault();
    const to = email.trim().toLowerCase();
    const isNew = !(members || []).some((m) => m.email === to);
    act(async () => { await rpc('dl_share', { p_id: project.id, p_email: to, p_role: role }); setEmail(''); track('compartir', { rol: role }); if (isNew) await mail(to); });
  };
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
        {notice && <p className="callout-sm" role="status">{notice}</p>}
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
                  <button type="button" className="btn btn-link btn-sm" disabled={busy} title="Enviarle un correo con el enlace" onClick={() => { setBusy(true); setError(''); setNotice(''); mail(m.email).finally(() => setBusy(false)); }}>Avisar</button>
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
        <p className="muted small">El enlace solo funciona para las personas de la lista, después de iniciar sesión con su correo. Al invitar le enviamos un correo con el enlace; también puedes mandárselo por WhatsApp.</p>
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
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    if (!id) { setError(new CloudError('No llegó el identificador de la transacción.')); return; }
    confirmPayment(id).then((d) => { setStatus(d.status); setPlan(d.plan || null); if (d.status === 'APPROVED') { track('pago_aprobado'); onDone?.(); } }).catch(setError);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [title, body] = error ? ['No pudimos confirmar el pago', error.message]
    : status === 'APPROVED' && plan === 'empresa' ? ['Pago aprobado', 'Tu plan DataLite Empresa quedó activo. Abre «Mi empresa» en el menú de tu cuenta para invitar a tu equipo.']
      : status ? (PAY_TEXT[status] || PAY_TEXT.PENDING) : ['Confirmando tu pago…', 'Un momento, estamos consultando a Wompi.'];
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

// ------------------------------------------------------------------ Plan Empresa

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export function EmpresaModal({ account, onClose, onChanged }) {
  const [org, setOrg] = useState(undefined); // undefined: cargando · null: sin empresa
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [seats, setSeats] = useState(5);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const load = () => rpc('dl_org_status').then((o) => { setOrg(o); if (o) setSeats(Math.max(o.seats, o.used, 5)); }).catch((e) => { setError(e.message); setOrg(null); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); await load(); onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  async function pay(e) {
    e?.preventDefault();
    if (!org && name.trim().length < 2) { setError('Escribe el nombre de la empresa.'); return; }
    setBusy(true); setError('');
    try { const url = await startCheckout('empresa', { seats, orgName: name.trim() }); track('checkout_empresa', { cupos: seats }); window.location.assign(url); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  const seatPicker = (min) => (
    <Field label="Usuarios (crean o editan tableros)">
      <select value={seats} onChange={(e) => setSeats(+e.target.value)}>{range(min, 20).map((n) => <option key={n} value={n}>{n} usuarios</option>)}</select>
    </Field>
  );
  const price = <p className="price-line"><b>{cop(orgYearTotal(seats))}</b> <span className="muted">COP al año · {seats} × {cop(seatMonthPrice(seats))} por usuario al mes</span></p>;
  // Incentivo: con 10 cupos el precio por usuario baja; de 7 a 9 usuarios se muestra cuánto cambia el total.
  const toTen = seats >= 7 && seats <= 9 && (!org || org.seats < 10) ? orgYearTotal(10) - orgYearTotal(seats) : null;
  const tenNudge = toTen === null ? null : (
    <div className="callout-sm nudge">
      {toTen < 0
        ? <>Con <b>10 usuarios</b> pagas <b>{cop(-toTen)} menos al año</b> y te sobra {10 - seats === 1 ? 'un cupo' : `${10 - seats} cupos`}: cada usuario queda a {cop(14900)}.</>
        : <>Por solo <b>{cop(toTen)} más al año</b> tienes <b>10 usuarios</b> a {cop(14900)} cada uno ({10 - seats} cupos más).</>}
      {' '}<button type="button" className="btn btn-link btn-sm" onClick={() => { setSeats(10); track('empresa_sugerencia_10', { desde: seats }); }}>Cambiar a 10 usuarios</button>
    </div>
  );

  if (org === undefined) return <Modal title="DataLite Empresa" onClose={onClose}><p className="muted">Cargando…</p></Modal>;

  if (!org) {
    return (
      <Modal title="DataLite Empresa" onClose={onClose}>
        <form className="stack" onSubmit={pay}>
          <ul className="ticks">
            <li>Cada persona con cupo tiene todo lo de Pro: guardar, compartir y descargar sin límite ni marca de agua</li>
            <li>Espacio común: los tableros del equipo los ven y editan todos sus miembros, sin invitar uno por uno</li>
            <li>Tú administras los cupos: invitas y quitas personas por correo</li>
            <li>Quien solo mira tableros compartidos no paga</li>
          </ul>
          <Field label="Nombre de la empresa"><input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Mi Empresa SAS" /></Field>
          {seatPicker(5)}
          {price}
          {tenNudge}
          <p className="muted small">De 5 a 9 usuarios: {cop(16900)} por usuario al mes. De 10 a 20: {cop(14900)}. Un solo pago por 12 meses con Wompi (tarjeta, PSE, Nequi o Bancolombia), sin renovación automática. ¿Más de 20 usuarios? Escríbenos a <a href="mailto:datalitecontact@gmail.com">datalitecontact@gmail.com</a>.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Abriendo Wompi…' : `Pagar ${cop(orgYearTotal(seats))} con Wompi`}</button>
        </form>
      </Modal>
    );
  }

  const admin = org.role === 'admin';
  const daysLeft = Math.ceil((new Date(org.period_end) - Date.now()) / 86400000);
  const addingSeats = org.active && seats > org.seats && daysLeft > 30;
  return (
    <Modal title={org.name} onClose={onClose}>
      <div className="stack">
        <p>{org.active ? <>Plan Empresa vigente hasta el <b>{fmtDate(org.period_end)}</b>.</> : <>El plan venció el <b>{fmtDate(org.period_end)}</b>. Los tableros del equipo quedan en solo lectura hasta renovarlo.</>} {admin ? `${org.used} de ${org.seats} cupos usados.` : `Administra: ${org.owner_email}.`}</p>
        {admin && (
          <>
            <form className="share-form" onSubmit={(e) => { e.preventDefault(); act(async () => { await rpc('dl_org_invite', { p_email: email }); setEmail(''); track('empresa_invitar'); }); }}>
              <input className="input" type="email" placeholder="correo@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Correo de la persona" required />
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !email.trim() || !org.active}>Agregar</button>
            </form>
            <p className="muted small">La persona entra a DataLite con ese correo y su cupo se activa sola. Envíale el enlace {location.origin} por WhatsApp o correo.</p>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {admin && (
          <ul className="member-list">
            {org.members.map((m) => (
              <li key={m.email}>
                <span>{m.email}{m.role === 'admin' && <span className="muted small"> · administra</span>}{!m.has_account && <span className="muted small"> · aún sin cuenta</span>}</span>
                {m.email !== org.owner_email && <button type="button" className="icon-btn" aria-label={`Quitar a ${m.email}`} disabled={busy} onClick={() => act(() => rpc('dl_org_remove', { p_email: m.email }))}><Icon name="close" /></button>}
              </li>
            ))}
          </ul>
        )}
        {admin && org.owner_email === account.status?.email && (
          <form className="stack org-pay" onSubmit={pay}>
            <h3 className="proj-h">{org.active ? 'Renovar o agregar cupos' : 'Renovar el plan'}</h3>
            {seatPicker(Math.max(5, org.used))}
            {addingSeats
              ? <p className="muted small">Pagas solo los {seats - org.seats} cupos nuevos por los {daysLeft} días que faltan; Wompi te muestra el valor exacto.</p>
              : <>{price}{tenNudge}<p className="muted small">{org.active ? 'Los 12 meses nuevos se suman al final del periodo vigente.' : 'El nuevo periodo empieza hoy.'}</p></>}
            <button type="submit" className="btn btn-ghost" disabled={busy}>{busy ? 'Abriendo Wompi…' : 'Pagar con Wompi'}</button>
          </form>
        )}
        {!admin && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { if (confirm(`¿Salir de ${org.name}? Perderás el acceso a sus tableros.`)) act(() => rpc('dl_org_remove', { p_email: account.status?.email })); }}>Salir de la empresa</button>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Administración (solo la cuenta administradora)

const STATE = (g) => (g.paid ? 'Ya pagó' : g.active ? 'Vigente' : 'Terminada');
export function AdminTrialsModal({ onClose }) {
  const [list, setList] = useState(null);
  const [f, setF] = useState({ email: '', kind: 'pro', days: 30, seats: 5, org: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [custom, setCustom] = useState({});
  const [mail, setMail] = useState(true);
  const load = () => rpc('dl_admin_list_grants').then((l) => setList(l || [])).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  // Aviso por correo (no bloquea: si falla, la acción ya quedó hecha)
  const tell = async (id, action) => {
    if (!mail || !id) return '';
    try { const r = await notifyTrial(id, action); return r.sent ? ' Le avisamos por correo.' : ' No enviamos correo porque hubo otro aviso hace menos de un minuto.'; }
    catch (e) { return ` La acción quedó hecha, pero el correo no salió: ${e.message}`; }
  };
  const act = async (fn, msg) => { setBusy(true); setError(''); setNotice(''); try { const extra = (await fn()) || ''; await load(); if (msg) setNotice(msg + extra); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const grant = (e) => {
    e.preventDefault();
    const email = f.email.trim().toLowerCase();
    act(async () => {
      const r = await rpc('dl_admin_grant', { p_email: email, p_kind: f.kind, p_days: Number(f.days), p_seats: Number(f.seats), p_org_name: f.kind === 'empresa' ? f.org.trim() : null, p_note: f.note.trim() || null });
      setF((x) => ({ ...x, email: '', org: '', note: '' }));
      track('admin_prueba_asignada', { tipo: f.kind });
      return tell(r?.id, 'asignar');
    }, `Prueba de ${f.kind === 'pro' ? 'Pro' : 'Empresa'} asignada a ${email} por ${f.days} días. La persona la verá al recargar DataLite.`);
  };
  const adjust = (g, days) => act(async () => { await rpc('dl_admin_adjust_grant', { p_id: g.id, p_days: days }); return tell(g.id, days > 0 ? 'prorrogar' : 'recortar'); }, days > 0 ? `Prorrogada ${days} días.` : `Recortada ${-days} días.`);
  const end = (g) => { if (confirm(`¿Terminar ya la prueba de ${g.email}?`)) act(async () => { await rpc('dl_admin_end_grant', { p_id: g.id }); return tell(g.id, 'terminar'); }, 'Prueba terminada.'); };

  return (
    <Modal title="Pruebas gratis asignadas" onClose={onClose} wide>
      <div className="stack">
        <p className="muted small">Solo tu cuenta de administrador puede ver esta ventana. La persona debe haber iniciado sesión en DataLite al menos una vez. Cada acción queda registrada.</p>
        <form className="stack admin-form" onSubmit={grant}>
          <div className="sched-grid">
            <Field label="Correo de la persona"><input className="input" type="email" required value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="persona@empresa.com" /></Field>
            <Field label="Plan"><select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="pro">Pro</option><option value="empresa">Empresa</option></select></Field>
            <Field label="Días (15 a 30)"><input className="input" type="number" min="15" max="30" required value={f.days} onChange={(e) => set('days', e.target.value)} /></Field>
          </div>
          {f.kind === 'empresa' && (
            <div className="sched-grid">
              <Field label="Nombre de la empresa"><input className="input" required minLength={2} maxLength={120} value={f.org} onChange={(e) => set('org', e.target.value)} /></Field>
              <Field label="Cupos (5 a 20)"><input className="input" type="number" min="5" max="20" required value={f.seats} onChange={(e) => set('seats', e.target.value)} /></Field>
            </div>
          )}
          <Field label="Nota interna (opcional)"><input className="input" maxLength={300} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Ej.: demo para gerencia, referido por…" /></Field>
          <label className="check"><input type="checkbox" checked={mail} onChange={(e) => setMail(e.target.checked)} /> Avisar por correo a la persona (al asignar, prorrogar, recortar o terminar)</label>
          <div><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Asignar prueba'}</button></div>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="callout-sm" role="status">{notice}</p>}
        <h3 className="proj-h">Asignadas</h3>
        {list === null ? <p className="muted">Cargando…</p> : list.length === 0 ? <p className="muted">Aún no has asignado pruebas.</p> : (
          <ul className="sched-list">
            {list.map((g) => (
              <li key={g.id} className={g.active ? '' : 'off'}>
                <span className={`sched-kind ${g.kind === 'empresa' ? 'alert' : ''}`}>{g.kind === 'pro' ? 'Pro' : 'Empresa'}</span>
                <div className="sched-info">
                  <b>{g.email}</b>
                  <span className="muted small">{STATE(g)} · {g.active ? 'vence' : 'terminó'} el {fmtDate(g.ends_at)}{g.org ? ` · ${g.org.name} (${g.org.used} de ${g.org.seats} cupos)` : ''}</span>
                  {g.note && <span className="muted small">{g.note}</span>}
                </div>
                {!(g.kind === 'empresa' && g.paid) && (
                  <div className="sched-acts">
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => adjust(g, 7)}>+7 días</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => adjust(g, 15)}>+15</button>
                    {g.active && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => adjust(g, -7)}>−7</button>}
                    <input className="input admin-days" type="number" aria-label={`Días para ${g.email}`} placeholder="± días" value={custom[g.id] || ''} onChange={(e) => setCustom((c) => ({ ...c, [g.id]: e.target.value }))} />
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !Number(custom[g.id])} onClick={() => { adjust(g, Number(custom[g.id])); setCustom((c) => ({ ...c, [g.id]: '' })); }}>Aplicar</button>
                    {g.active && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => end(g)}>Terminar</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Prorrogar suma días a la fecha de fin (si ya terminó, cuenta desde hoy). Recortar resta días; si llega a hoy, la prueba termina. Una prueba no puede durar más de un año en total. Las pruebas de Empresa que ya pagaron se manejan con su plan normal.</p>
      </div>
    </Modal>
  );
}
