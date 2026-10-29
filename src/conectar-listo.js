// Retorno del permiso permanente: avisa a la ventana de DataLite y se cierra.
(function () {
  var q = new URLSearchParams(location.search);
  var r = q.get('r') || 'error';
  var p = q.get('p') === 'microsoft' ? 'microsoft' : 'google';
  history.replaceState(null, '', location.pathname);
  var msg = { type: 'dl-conexion', ok: r === 'ok', result: r, provider: p };
  var done = false;
  try { var bc = new BroadcastChannel('dl-conexion'); bc.postMessage(msg); bc.close(); done = true; } catch (e) { /* sin soporte */ }
  try { if (window.opener && window.opener.location.origin === location.origin) { window.opener.postMessage(msg, location.origin); done = true; } } catch (e) { /* otro origen */ }
  var TEXT = {
    ok: 'Listo: DataLite ya puede leer la hoja para tus reportes y alertas. Puedes cerrar esta ventana.',
    negado: 'No diste el permiso. Puedes intentarlo de nuevo desde «Programar».',
    sinpermiso: 'El proveedor no entregó el permiso permanente. Intenta de nuevo y acepta todos los permisos.',
    estado: 'El enlace venció. Vuelve a intentarlo desde «Programar».',
    error: 'No pudimos guardar el permiso. Intenta de nuevo en unos minutos.',
  };
  document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('cx-msg');
    if (el) el.textContent = TEXT[r] || TEXT.error;
    if (done && r === 'ok') setTimeout(function () { window.close(); }, 1200);
  });
})();
