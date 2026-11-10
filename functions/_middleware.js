// Runs on every page view:
// - every HTML page gets the current skipped Sundays (set on the private orders page), so the
//   "Next delivery" date is right without rebuilding the site;
// - the homepage also gets this week's markets (from the operations sheet Plan tab) swapped in.
// Everything else (files, /api/…) passes straight through. If KV or the sheet can't be read,
// the built version (site.json skipDates, "coming soon" markets) is shown.
import marketsData from '../data/markets.json';
import { getPlan } from './_lib/plan.js';
import { skipDates } from './_lib/skip.js';
import { scheduleFromPlan, scheduleBlocks } from '../lib/schedule.mjs';

const { markets } = marketsData;
const HOME = new Set(['/', '/index.html']);
const isPage = (p) => !p.startsWith('/api/') && (p.endsWith('/') || p.endsWith('.html') || !/\.[a-z0-9]+$/i.test(p));

export async function onRequest({ request, next, env, waitUntil }) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || !isPage(url.pathname)) return next();
  const home = HOME.has(url.pathname);
  // Ask for the full page (not "unchanged since last time"), so the dates and schedule are always fresh.
  const fresh = new Request(request);
  fresh.headers.delete('if-none-match');
  fresh.headers.delete('if-modified-since');
  const [res, skip, plan] = await Promise.all([
    next(fresh),
    skipDates(env).catch(() => null),
    home ? getPlan(env, waitUntil).catch(() => null) : null,
  ]);
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res;

  let rw = new HTMLRewriter();
  if (skip) {
    const js = `<script>if(window.HY&&HY.site)HY.site.skipDates=${JSON.stringify(skip)};</script>`;
    // Right after the page data script, before /js/site.js runs.
    rw = rw.on('script[src^="/js/site.js"]', { element(el) { el.before(js, { html: true }); } });
  }
  if (plan && Array.isArray(plan.markets)) {
    const blocks = scheduleBlocks(scheduleFromPlan(plan.markets, markets), markets);
    rw = rw.on('[data-sched]', {
      element(el) {
        const f = blocks[el.getAttribute('data-sched')];
        if (f) el.setInnerContent(f(), { html: true });
      },
    });
  }
  const out = rw.transform(res);
  const headers = new Headers(out.headers);
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  headers.delete('etag');
  headers.delete('last-modified');
  return new Response(out.body, { status: out.status, headers });
}
