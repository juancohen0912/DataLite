import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { sendMail, buildMessage, inviteEmail, isSafeEmail } from '../api/_lib/smtp.js';

function fakeServer({ authOk = true } = {}) {
  const log = [];
  const server = net.createServer((s) => {
    s.setEncoding('utf8');
    let inData = false, data = '';
    s.write('220 fake ESMTP\r\n');
    s.on('data', (chunk) => {
      if (inData) {
        data += chunk;
        if (data.endsWith('\r\n.\r\n')) { inData = false; log.push(['DATA', data]); s.write('250 queued\r\n'); }
        return;
      }
      for (const line of chunk.split('\r\n').filter(Boolean)) {
        log.push(line);
        if (line.startsWith('EHLO')) s.write('250-fake\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n');
        else if (line === 'AUTH LOGIN') s.write('334 VXNlcm5hbWU6\r\n');
        else if (log.length === 3) s.write('334 UGFzc3dvcmQ6\r\n');
        else if (log.length === 4) s.write(authOk ? '235 ok\r\n' : '535 5.7.8 Username and Password not accepted\r\n');
        else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) s.write('250 ok\r\n');
        else if (line === 'DATA') { inData = true; data = ''; s.write('354 go\r\n'); }
        else if (line === 'QUIT') { s.write('221 bye\r\n'); s.end(); }
      }
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, log, port: server.address().port })));
}

test('envía el mensaje con AUTH LOGIN y termina con QUIT', async () => {
  const { server, log, port } = await fakeServer();
  const data = buildMessage({ fromName: 'DataLite', fromEmail: 'app@gmail.com', to: 'invitado@empresa.co', subject: 'Hola «ñ»', text: 'linea\n.empieza con punto', html: '<p>hola</p>' });
  await sendMail({ user: 'app@gmail.com', pass: 'abcdefghijklmnop', timeoutMs: 3000 }, { from: 'app@gmail.com', to: 'invitado@empresa.co', data }, { connect: () => net.connect(port, '127.0.0.1') });
  server.close();
  assert.equal(log[1], 'AUTH LOGIN');
  assert.equal(Buffer.from(log[2], 'base64').toString(), 'app@gmail.com');
  assert.equal(Buffer.from(log[3], 'base64').toString(), 'abcdefghijklmnop');
  assert.ok(log.includes('RCPT TO:<invitado@empresa.co>'));
  const msg = log.find((x) => Array.isArray(x))[1];
  assert.match(msg, /Subject: =\?UTF-8\?B\?/);
  assert.match(msg, /Content-Transfer-Encoding: base64/);
  assert.ok(msg.endsWith('\r\n.\r\n'));
});

test('credenciales rechazadas: error con el código SMTP', async () => {
  const { server, port } = await fakeServer({ authOk: false });
  await assert.rejects(
    sendMail({ user: 'a@gmail.com', pass: 'x', timeoutMs: 3000 }, { from: 'a@gmail.com', to: 'b@c.co', data: 'x' }, { connect: () => net.connect(port, '127.0.0.1') }),
    (e) => e.code === 535,
  );
  server.close();
});

test('bloquea inyección de cabeceras en correos', () => {
  for (const bad of ['a@b.co\r\nBcc: x@y.co', 'a@b.co>', 'a b@c.co', '"a"@b.co', 'a@b', '', null, 'a@b.co,c@d.co']) assert.equal(isSafeEmail(bad), false, String(bad));
  assert.equal(isSafeEmail('juan.perez+datos@empresa.com.co'), true);
  assert.throws(() => buildMessage({ fromName: 'x', fromEmail: 'a@b.co', to: 'c@d.co\r\nBcc: e@f.co', subject: 's', text: 't', html: 'h' }));
  const m = buildMessage({ fromName: 'Nombre\r\nBcc: x@y.co', fromEmail: 'a@b.co', to: 'c@d.co', subject: 'Asunto\r\nBcc: x@y.co', text: 't', html: 'h' });
  assert.equal(m.split('\r\n\r\n')[0].includes('Bcc'), false);
});

test('la plantilla escapa el nombre del proyecto y el correo del dueño', () => {
  const { subject, html, text } = inviteEmail({ ownerEmail: 'dueno@empresa.co', projectName: 'Ventas <img src=x onerror=alert(1)>\r\nQ3', role: 'editor', link: 'https://data-lite.vercel.app/?p=11111111-0000-4000-8000-000000000001' });
  assert.equal(html.includes('<img'), false);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(/[\r\n]/.test(subject), false);
  assert.match(text, /verlo y editarlo/);
  assert.match(html, /href="https:\/\/data-lite\.vercel\.app\/\?p=11111111/);
});
