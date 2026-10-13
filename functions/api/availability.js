// GET /api/availability  →  { unavailable: ["sabich", ...] }  (items not being made this week)
import { getAvailability } from '../_lib/availability.js';

export async function onRequestGet({ env, waitUntil }) {
  const a = await getAvailability(env, waitUntil);
  return new Response(JSON.stringify({ unavailable: a.unavailable, planDate: a.planDate }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  });
}
