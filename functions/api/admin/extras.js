// Private: read or change the extra-bowls offer (password-protected by _middleware.js).
// GET  /api/admin/extras  →  { enabled, config, sold, open, defaultWindow }
// POST /api/admin/extras  { days: ['YYYY-MM-DD'], stock: { itemId: n }, window }  or  { off: true }
import menu from '../../../data/menu.json';
import site from '../../../data/site.json';
import { readExtras, writeExtras, extrasAdminView, todayNC } from '../../_lib/extras.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const ids = new Set([...menu.bowls, ...menu.extras].filter((i) => i.available).map((i) => i.id));

export async function onRequestGet({ env }) {
  try { return json(await extrasAdminView(env)); } catch (e) { return json({ error: e.message }, 502); }
}

export async function onRequestPost({ request, env }) {
  if (!env.EXTRAS) return json({ error: 'Extra bowls need a one-time setup in Cloudflare (KV binding EXTRAS).' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  if (body.off) {
    const cfg = await readExtras(env);
    await writeExtras(env, { ...(cfg || {}), days: [], updatedAt: new Date().toISOString() });
    return json(await extrasAdminView(env));
  }

  const today = todayNC();
  const wd = site.fulfillmentWeekday ?? 0;
  const days = [...new Set((Array.isArray(body.days) ? body.days : []).map(String))]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today && new Date(d + 'T12:00:00Z').getUTCDay() !== wd)
    .sort().slice(0, 7);
  if (!days.length) return json({ error: 'Pick at least one day (not a Sunday: Sunday orders work as usual).' }, 400);
  const stock = {};
  for (const [id, n] of Object.entries(body.stock || {})) {
    const v = Math.floor(Number(n));
    if (ids.has(id) && v > 0) stock[id] = Math.min(v, 500);
  }
  if (!Object.keys(stock).length) return json({ error: 'Enter how many you have of at least one item.' }, 400);
  const window = String(body.window || site.extraWindow || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  await writeExtras(env, { days, stock, window, updatedAt: new Date().toISOString() });
  return json(await extrasAdminView(env));
}
