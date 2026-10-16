// GET /api/schedule  →  this week's public market lineup from the operations sheet Plan tab
// (same data as the homepage market section). Used by the Instagram story job.
import marketsData from '../../data/markets.json';
import { getPlan } from '../_lib/plan.js';
import { scheduleFromPlan } from '../../lib/schedule.mjs';

const { markets } = marketsData;

export async function onRequestGet({ env, waitUntil }) {
  const plan = await getPlan(env, waitUntil).catch(() => null);
  const s = plan && Array.isArray(plan.markets) ? scheduleFromPlan(plan.markets, markets) : { days: [] };
  const days = (s.days || []).map((d) => ({
    date: d.date,
    markets: d.markets.map((x) => {
      const m = markets.find((y) => y.id === x.id) || {};
      return { id: m.id, name: m.name, town: m.town, storyTown: m.storyTown || '', color: m.color, hours: x.hours };
    }),
  }));
  return new Response(JSON.stringify({ source: plan ? 'sheet' : 'none', days }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
