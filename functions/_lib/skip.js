// Sundays with no website orders (weeks Hummus Y'all isn't producing).
// Alon ticks them on the private orders page; they are kept in Cloudflare KV (binding EXTRAS,
// key "skip-sundays"). Until he saves once, the list in data/site.json (skipDates) is used.
// The site then shows the next Sunday that isn't skipped, and checkout takes orders for that one.
//
// Stored: { dates: ['YYYY-MM-DD', ...], updatedAt }
import site from '../../data/site.json';

const KEY = 'skip-sundays';

export const todayNC = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);

export async function readSkip(env) {
  if (!env.EXTRAS) return null;
  try { return JSON.parse((await env.EXTRAS.get(KEY)) || 'null'); } catch { return null; }
}

// The Sundays being skipped right now (today or later).
export async function skipDates(env) {
  const saved = await readSkip(env).catch(() => null);
  const list = saved && Array.isArray(saved.dates) ? saved.dates : (site.skipDates || []);
  const today = todayNC();
  return list.filter((d) => d >= today).sort();
}

export async function writeSkip(env, dates) {
  await env.EXTRAS.put(KEY, JSON.stringify({ dates, updatedAt: new Date().toISOString() }));
}
