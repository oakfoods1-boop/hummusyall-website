// What's on the menu this week, read from the market operations sheet (Plan tab, TOTAL row)
// through the same Google Apps Script the website forms use. An item whose Plan column total is 0
// is "not available this week". Items without a "plan" column in data/menu.json (pita) are always available.
// If the sheet can't be reached, nothing is blocked (we'd rather take an order than lose one).
import menu from '../../data/menu.json';

const CACHE_SECONDS = 300;   // the sheet is read at most every 5 minutes
const CACHE_KEY = 'https://cache.hummusyall.internal/availability-v1';

async function readPlan(env) {
  if (!env.FORM_WEBHOOK_URL) return null;
  const res = await fetch(env.FORM_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.FORM_SECRET || '', action: 'availability' }),
    redirect: 'follow',
  });
  const data = await res.json().catch(() => null);
  return data && data.ok && data.totals ? data : null;
}

// Returns { source: 'sheet' | 'none', planDate, unavailable: [item ids] }
export async function getAvailability(env, waitUntil) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(CACHE_KEY).catch(() => null);
    if (hit) return hit.json();
  }
  let plan = null;
  try { plan = await readPlan(env); } catch (e) { console.log('availability: sheet not reachable', e.message); }
  const items = [...menu.bowls, ...menu.extras];
  const result = plan
    ? {
        source: 'sheet',
        planDate: plan.date || '',
        unavailable: items.filter((i) => i.plan && i.plan in plan.totals && !(Number(plan.totals[i.plan]) > 0)).map((i) => i.id),
      }
    : { source: 'none', planDate: '', unavailable: [] };
  if (cache) {
    // Cache a failure only briefly so a hiccup doesn't hide the real menu for long.
    const ttl = plan ? CACHE_SECONDS : 30;
    const put = cache.put(CACHE_KEY, new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` } }));
    if (waitUntil) waitUntil(put.catch(() => {})); else await put.catch(() => {});
  }
  return result;
}
