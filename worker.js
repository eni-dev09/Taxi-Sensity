// ═══════════════════════════════════════════════════════════
// TAXI DOWNTOWN — Cloudflare Worker
// Proxy sécurisé vers JSONBin
//
// Secrets à définir dans Cloudflare (Settings → Variables) :
//   JSONBIN_KEY        (obligatoire) — clé API JSONBin
//   JSONBIN_BIN_ID     (obligatoire) — ID du bin
//   ADMIN_CODE         (obligatoire) — code admin (ex: DOWNTOWN26)
//   DISCORD_WEBHOOK    (optionnel)   — webhook Discord pour notifs
//   PRESENCE           (optionnel)   — KV namespace pour compter en ligne
// ═══════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Code',
  'Access-Control-Max-Age': '86400'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;
    const ADMIN_CODE = env.ADMIN_CODE || 'DOWNTOWN26';
    const JSONBIN_KEY = env.JSONBIN_KEY;
    const BIN_ID = env.JSONBIN_BIN_ID;
    const DISCORD_WEBHOOK = env.DISCORD_WEBHOOK || '';

    if (!JSONBIN_KEY || !BIN_ID) return json({ error: 'Worker mal configuré' }, 500);

    try {
      // ─── LECTURE PUBLIQUE ───
      if (path === '/data' && request.method === 'GET') {
        const r = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
          headers: { 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Meta': 'false' }
        });
        if (!r.ok) return json({ error: 'JSONBin ' + r.status }, 502);
        return new Response(await r.text(), {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
      }

      // ─── ÉCRITURE ADMIN ───
      if (path === '/data' && request.method === 'PUT') {
        const code = request.headers.get('X-Admin-Code');
        if (!code || code !== ADMIN_CODE) return json({ error: 'Unauthorized' }, 401);

        const body = await request.text();
        if (body.length > 5 * 1024 * 1024) return json({ error: 'Payload too large' }, 413);
        try { JSON.parse(body); } catch { return json({ error: 'Invalid JSON' }, 400); }

        const r = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
          body
        });
        if (!r.ok) return json({ error: 'JSONBin ' + r.status }, 502);
        return json({ ok: true });
      }

      // ─── PRÉSENCE ───
      if (path === '/presence' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const sid = String(body.sessionId || 'anon').slice(0, 40);
        if (env.PRESENCE) {
          await env.PRESENCE.put('p:' + sid, String(Date.now()), { expirationTtl: 120 });
          const list = await env.PRESENCE.list({ prefix: 'p:' });
          return json({ online: list.keys.length });
        }
        return json({ online: 1 });
      }

      // ─── RÉSERVATION → DISCORD ───
      if (path === '/reservation' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body) return json({ error: 'Bad request' }, 400);

        if (DISCORD_WEBHOOK) {
          const payload = {
            content: '🚕 **Nouvelle réservation de course**',
            embeds: [{
              title: `${body.from || '?'} → ${body.to || '?'}`,
              color: 0xa78bfa,
              fields: [
                { name: 'Client', value: String(body.name || 'Anonyme').slice(0, 80), inline: true },
                { name: 'Discord', value: String(body.discord || '—').slice(0, 80), inline: true },
                { name: 'Type', value: String(body.type || 'En ville').slice(0, 40), inline: true },
                { name: 'Heure', value: String(body.time || 'Dès que possible').slice(0, 60), inline: true },
                { name: 'Notes', value: String(body.notes || '—').slice(0, 500) }
              ],
              timestamp: new Date().toISOString()
            }]
          };
          await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }).catch(() => {});
        }
        return json({ ok: true });
      }

      // ─── NOTIF ADMIN → DISCORD ───
      if (path === '/notify' && request.method === 'POST') {
        const code = request.headers.get('X-Admin-Code');
        if (!code || code !== ADMIN_CODE) return json({ error: 'Unauthorized' }, 401);

        const body = await request.json().catch(() => null);
        if (!body || !DISCORD_WEBHOOK) return json({ ok: false });

        await fetch(DISCORD_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: String(body.message || '').slice(0, 1900) })
        }).catch(() => {});
        return json({ ok: true });
      }

      // ─── Health ───
      if (path === '/' || path === '/health') {
        return json({ ok: true, service: 'taxi-downtown', ts: Date.now() });
      }

      return json({ error: 'Not found', path }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  }
};