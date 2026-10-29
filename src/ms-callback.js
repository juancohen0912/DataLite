// Retorno de Microsoft (ventana emergente): entrega el código a la ventana de DataLite y se cierra.
// Corre antes que cualquier otro script y borra el código de la URL de inmediato.
(function () {
  var q = new URLSearchParams(location.search);
  var msg = { type: 'dl-microsoft', code: q.get('code'), state: q.get('state'), error: q.get('error') };
  history.replaceState(null, '', location.pathname);
  var done = false;
  // Respaldo por si el navegador cortó el vínculo con la ventana que abrió esta (mismo origen, validado por state)
  try { var bc = new BroadcastChannel('dl-microsoft'); bc.postMessage(msg); bc.close(); done = true; } catch (e) { /* sin soporte */ }
  try {
    if (window.opener && window.opener.location.origin === location.origin) { window.opener.postMessage(msg, location.origin); done = true; }
  } catch (e) { /* ventana de otro origen */ }
  document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('ms-msg');
    if (el) el.textContent = done ? 'Listo. Puedes cerrar esta ventana.' : 'Abre esta conexión desde DataLite.';
    if (done) setTimeout(function () { window.close(); }, 300);
  });
})();
