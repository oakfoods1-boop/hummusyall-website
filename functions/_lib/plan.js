// Reads the Plan tab of the market operations sheet through the forms Apps Script
// (integrations/forms-to-sheet.gs, action "availability"). Cached for 5 minutes, so the sheet is
// read at most a few times an hour no matter how many visitors. Returns null if it can't be read.
const CACHE_SECONDS = 300;
const CACHE_KEY = 'https://cache.hummusyall.internal/plan-v2';

async function fetchPlan(env) {
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

// { totals: {column: number}, markets?: [{name, date}], date } or null
export async function getPlan(env, waitUntil) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(CACHE_KEY).catch(() => null);
    if (hit) return hit.json();
  }
  let plan = null;
  try { plan = await fetchPlan(env); } catch (e) { console.log('plan: sheet not reachable', e.message); }
  if (cache) {
    // Remember a failure only briefly so a hiccup doesn't stick.
    const put = cache.put(CACHE_KEY, new Response(JSON.stringify(plan), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${plan ? CACHE_SECONDS : 30}` } }));
    if (waitUntil) waitUntil(put.catch(() => {})); else await put.catch(() => {});
  }
  return plan;
}
