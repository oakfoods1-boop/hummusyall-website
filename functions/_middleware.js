// Swaps this week's markets (from the operations sheet Plan tab) into the homepage market section.
// Every other request passes straight through. If the sheet can't be read, the built "coming soon"
// version is shown.
import marketsData from '../data/markets.json';
import { getPlan } from './_lib/plan.js';
import { scheduleFromPlan, scheduleBlocks } from '../lib/schedule.mjs';

const { markets } = marketsData;
const PAGES = new Set(['/', '/index.html']);

export async function onRequest({ request, next, env, waitUntil }) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || !PAGES.has(url.pathname)) return next();
  // Ask for the full page (not "unchanged since last time"), so the schedule is always fresh.
  const fresh = new Request(request);
  fresh.headers.delete('if-none-match');
  fresh.headers.delete('if-modified-since');
  const [res, plan] = await Promise.all([next(fresh), getPlan(env, waitUntil).catch(() => null)]);
  if (!plan || !Array.isArray(plan.markets) || !(res.headers.get('content-type') || '').includes('text/html')) return res;

  const schedule = scheduleFromPlan(plan.markets, markets);
  const blocks = scheduleBlocks(schedule, markets);
  const out = new HTMLRewriter()
    .on('[data-sched]', {
      element(el) {
        const f = blocks[el.getAttribute('data-sched')];
        if (f) el.setInnerContent(f(), { html: true });
      },
    })
    // The map script reads window.HY.schedule.
    .on('body', {
      element(el) {
        el.append(`<script>window.HY&&(window.HY.schedule=${JSON.stringify(schedule).replace(/</g, '\\u003c')})</script>`, { html: true });
      },
    })
    .transform(res);
  const headers = new Headers(out.headers);
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  headers.delete('etag');
  headers.delete('last-modified');
  return new Response(out.body, { status: out.status, headers });
}
