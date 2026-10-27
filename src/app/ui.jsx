import React, { useEffect, useRef, useState } from 'react';

export const track = (name, data) => { try { window.va?.('event', { name, data }); } catch { /* sin analítica */ } };

export function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="field-hint">{hint}</small>}</label>;
}

const PATHS = {
  edit: 'M11.5 2.5l2 2-8 8H3.5v-2l8-8z',
  more: 'M3 8h.01M8 8h.01M13 8h.01',
  close: 'M4 4l8 8M12 4l-8 8',
  plus: 'M8 3v10M3 8h10',
  fx: 'M6 13c1.5 0 2-1 2.3-3L9 5c.3-1.5.9-2 2-2M5.5 7.5h5',
  table: 'M2.5 3.5h11v9h-11zM2.5 7h11M6.5 3.5v9',
  copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
  image: 'M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3',
  palette: 'M8 2.5a5.5 5.5 0 100 11c.9 0 1.2-.6.9-1.3-.4-.8.1-1.7 1-1.7h1.4a2.2 2.2 0 002.2-2.2A5.6 5.6 0 008 2.5zM5 7.5h.01M7 5h.01M10 5.5h.01',
  share: 'M11 5.5a2 2 0 100-4 2 2 0 000 4zM5 10a2 2 0 100-4 2 2 0 000 4zM11 14.5a2 2 0 100-4 2 2 0 000 4zM6.8 9l2.4 1.5M9.2 5.5L6.8 7',
  save: 'M3 2.5h8l2.5 2.5v8.5h-10.5zM5.5 2.5v3.5h5v-3.5M5 13.5v-4h6v4',
  user: 'M8 8a2.8 2.8 0 100-5.6A2.8 2.8 0 008 8zM2.8 14a5.2 5.2 0 0110.4 0',
  lock: 'M4.5 7.5h7v6h-7zM6 7.5V5.5a2 2 0 014 0v2',
  folder: 'M2 4.5h4l1.5 1.5H14v7H2z',
  left: 'M10 3L5 8l5 5',
  right: 'M6 3l5 5-5 5',
  filter: 'M2.5 3.5h11l-4.3 5v4l-2.4 1v-5z',
  calendar: 'M3 4h10v9.5H3zM3 7h10M6 2.5v3M10 2.5v3',
};
export function Icon({ name, size = 16 }) {
  return <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={PATHS[name]} /></svg>;
}

/** Menú desplegable accesible: se cierra con Escape o clic afuera. */
export function Menu({ label, icon, items, className = '', buttonClass = 'btn btn-ghost btn-sm', align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className={`menu ${className}`} ref={ref}>
      <button type="button" className={buttonClass} aria-haspopup="menu" aria-expanded={open} aria-label={typeof label === 'string' ? label : undefined} onClick={() => setOpen((o) => !o)}>
        {icon && <Icon name={icon} />}{typeof label === 'string' && !icon ? label : icon ? null : label}
      </button>
      {open && (
        <ul className={`menu-list ${align === 'left' ? 'menu-left' : ''}`} role="menu">
          {items.filter(Boolean).map((it, i) => (
            <li key={i}>
              <button role="menuitem" type="button" disabled={it.disabled} className={it.danger ? 'danger' : ''} onClick={() => { setOpen(false); it.onClick(); }}>
                {it.label}{it.hint && <small>{it.hint}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Ventana modal con foco atrapado de forma simple y cierre con Escape. */
export function Modal({ title, onClose, children, wide = false, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button:not(.modal-x)')?.focus();
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', esc); document.body.classList.remove('modal-open'); prev?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-x" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Aviso breve en la parte inferior. */
export function useToast() {
  const [msg, setMsg] = useState(null);
  const timer = useRef(null);
  const show = (text, kind = 'ok') => { clearTimeout(timer.current); setMsg({ text, kind }); timer.current = setTimeout(() => setMsg(null), 4200); };
  const node = msg ? <div className={`toast toast-${msg.kind}`} role="status">{msg.text}</div> : null;
  return [node, show];
}
