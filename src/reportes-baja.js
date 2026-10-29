// Página de baja: confirma con un botón (los lectores de enlaces de correo no dan de baja por error).
(function () {
  var q = new URLSearchParams(location.search);
  var data = { s: q.get('s'), e: q.get('e'), t: q.get('t') };
  history.replaceState(null, '', location.pathname);
  function send(all) {
    var msg = document.getElementById('bj-msg');
    document.querySelectorAll('[data-baja]').forEach(function (b) { b.disabled = true; });
    fetch('/api/reportes/baja', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s: data.s, e: data.e, t: data.t, all: all }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        msg.textContent = x.ok ? (all ? 'Listo: no volverás a recibir reportes ni alertas de DataLite en ' + data.e + '.' : 'Listo: ya no recibirás este envío en ' + data.e + '.') : (x.j.error || 'No pudimos procesar la baja.');
        if (!x.ok) document.querySelectorAll('[data-baja]').forEach(function (b) { b.disabled = false; });
      })
      .catch(function () { msg.textContent = 'Sin conexión. Intenta de nuevo.'; document.querySelectorAll('[data-baja]').forEach(function (b) { b.disabled = false; }); });
  }
  document.addEventListener('DOMContentLoaded', function () {
    var who = document.getElementById('bj-email');
    if (!data.s || !data.e || !data.t) { document.getElementById('bj-msg').textContent = 'El enlace está incompleto. Usa el enlace de tu correo.'; document.getElementById('bj-actions').hidden = true; return; }
    who.textContent = data.e;
    document.getElementById('bj-uno').addEventListener('click', function () { send(false); });
    document.getElementById('bj-todo').addEventListener('click', function () { send(true); });
  });
})();
