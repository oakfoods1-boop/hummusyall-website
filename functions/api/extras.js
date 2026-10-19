// GET /api/extras  →  { extras: null } or { extras: { days, window, remaining: { itemId: n } } }
// Leftover bowls on offer for pickup/delivery on days other than Sunday (see functions/_lib/extras.js).
import { cachedExtrasStatus } from '../_lib/extras.js';

export async function onRequestGet({ env, waitUntil }) {
  const extras = await cachedExtrasStatus(env, waitUntil).catch(() => null);
  return new Response(JSON.stringify({ extras }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
