// Private: read or change the Sundays with no website orders (password-protected by _middleware.js).
// GET  /api/admin/skip  →  { enabled, dates, next }
// POST /api/admin/skip  { dates: ['YYYY-MM-DD'] }  (the full list; an empty list = no Sundays skipped)
import site from '../../../data/site.json';
import { skipDates, writeSkip, todayNC } from '../../_lib/skip.js';
import { nextFulfillment } from '../../_lib/fulfillment.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function view(env, saved) {
  const dates = saved || await skipDates(env);
  return { enabled: !!env.EXTRAS, dates, next: nextFulfillment({ ...site, skipDates: dates }) };
}

export async function onRequestGet({ env }) {
  try { return json(await view(env)); } catch (e) { return json({ error: e.message }, 502); }
}

export async function onRequestPost({ request, env }) {
  if (!env.EXTRAS) return json({ error: 'Skipping Sundays needs a one-time setup in Cloudflare (KV binding EXTRAS).' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const today = todayNC();
  const wd = site.fulfillmentWeekday ?? 0;
  const dates = [...new Set((Array.isArray(body.dates) ? body.dates : []).map(String))]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today && new Date(d + 'T12:00:00Z').getUTCDay() === wd)
    .sort().slice(0, 30);
  await writeSkip(env, dates);
  return json(await view(env, dates));
}
