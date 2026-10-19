// Extra bowls: leftovers Alon offers for pickup or delivery on days other than Sunday.
// He enters the counts and days on the private orders page; they are kept in Cloudflare KV
// (binding EXTRAS, key "current"). Without the binding the feature is simply off.
//
// Stored: { days: ['YYYY-MM-DD', ...], stock: { itemId: count }, window: '9 AM – 7 PM', updatedAt }
// The stock is one pile shared by all the extra days: what Alon has on hand when he saves. What's left =
// stock − items in paid website orders for those days placed since he saved (counted live from Square).
import menu from '../../data/menu.json';
import site from '../../data/site.json';
import { square } from './square.js';

const KEY = 'current';
const CACHE_KEY = 'https://cache.hummusyall.internal/extras-v1';
const CACHE_SECONDS = 30;
const items = [...menu.bowls, ...menu.extras].filter((i) => i.available);
const idByName = Object.fromEntries(items.map((i) => [(i.name + (i.size ? ` (${i.size})` : '')).toLowerCase(), i.id]));

export const todayNC = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
const minutesNC = (now = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
};
export const extraWindow = (cfg) => String((cfg && cfg.window) || site.extraWindow || '').trim();

export async function readExtras(env) {
  if (!env.EXTRAS) return null;
  try { return JSON.parse((await env.EXTRAS.get(KEY)) || 'null'); } catch { return null; }
}

export async function writeExtras(env, cfg) {
  await env.EXTRAS.put(KEY, JSON.stringify(cfg));
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) await cache.delete(CACHE_KEY).catch(() => {});
}

// Days still open for ordering: today until the same-day cutoff (site.extraSameDayCutoff), later days all day.
export function openDays(cfg, now = new Date()) {
  const today = todayNC(now);
  const cut = site.extraSameDayCutoff || { hour: 17, minute: 0 };
  const sameDayOpen = minutesNC(now) < cut.hour * 60 + cut.minute;
  return ((cfg && cfg.days) || []).filter((d) => d > today || (d === today && sameDayOpen)).sort();
}

// Items sold on the extra days since the counts were saved (paid website orders, not refunded).
async function soldOn(env, cfg) {
  const days = (cfg && cfg.days) || [];
  if (!days.length) return {};
  const since = cfg.updatedAt || new Date(Date.now() - 10 * 864e5).toISOString();
  const want = new Set(days.flatMap((d) => [`web-${d}-pickup`, `web-${d}-delivery`]));
  const sold = {};
  let cursor, n = 0;
  do {
    const data = await square(env, '/v2/orders/search', {
      method: 'POST',
      body: {
        location_ids: [env.SQUARE_LOCATION_ID], cursor, limit: 200,
        query: { filter: { state_filter: { states: ['OPEN', 'COMPLETED'] }, date_time_filter: { created_at: { start_at: since } } } },
      },
    });
    for (const o of data.orders || []) {
      if (!want.has(o.reference_id || '') || !(o.tenders || []).length || (o.refunds || []).length) continue;
      for (const li of o.line_items || []) {
        const id = idByName[String(li.name || '').toLowerCase()];
        if (id) sold[id] = (sold[id] || 0) + Number(li.quantity || 0);
      }
    }
    cursor = data.cursor; n += (data.orders || []).length;
  } while (cursor && n < 1000);
  return sold;
}

// What customers can order on the extra days right now, or null when nothing is on offer.
// { days: [...], window, remaining: { itemId: n }, unlimited: [itemId] }
// remaining = items with something left; unlimited = items without a Plan column (pita, kept frozen)
// that Alon didn't count, which can always be added.
export async function extrasStatus(env, now = new Date()) {
  const cfg = await readExtras(env);
  const days = openDays(cfg, now);
  if (!cfg || !days.length) return null;
  const sold = env.SQUARE_ACCESS_TOKEN ? await soldOn(env, cfg) : {};
  const remaining = {};
  for (const [id, n] of Object.entries(cfg.stock || {})) {
    const left = Math.floor(Number(n) || 0) - (sold[id] || 0);
    if (left > 0 && items.some((i) => i.id === id)) remaining[id] = left;
  }
  if (!Object.keys(remaining).length) return null;
  const unlimited = items.filter((i) => !i.plan && !((cfg.stock || {})[i.id] > 0)).map((i) => i.id);
  return { days, window: extraWindow(cfg), remaining, unlimited };
}

// Same as extrasStatus, shared for 30 seconds (for every page view's banner and the order page).
export async function cachedExtrasStatus(env, waitUntil) {
  if (!env.EXTRAS) return null;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(CACHE_KEY).catch(() => null);
    if (hit) return hit.json();
  }
  let status = null;
  try { status = await extrasStatus(env); } catch (e) { console.log('extras: status failed', e.message); }
  if (cache) {
    const put = cache.put(CACHE_KEY, new Response(JSON.stringify(status), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` } }));
    if (waitUntil) waitUntil(put.catch(() => {})); else await put.catch(() => {});
  }
  return status;
}

// For the private orders page: the saved settings plus what has sold so far.
export async function extrasAdminView(env) {
  const cfg = await readExtras(env);
  const sold = cfg && env.SQUARE_ACCESS_TOKEN ? await soldOn(env, cfg).catch(() => ({})) : {};
  return { enabled: !!env.EXTRAS, config: cfg, sold, open: openDays(cfg), defaultWindow: site.extraWindow || '' };
}
