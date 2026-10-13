// This week's markets: built from the operations sheet Plan tab, rendered the same way
// at build time (no sheet → "coming soon" state) and live by functions/_middleware.js.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (iso, opts) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const weekday = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();

export const todayNC = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);

// Hours for a market on a given date, from its "times" rules in data/markets.json.
export function hoursFor(m, iso) {
  const wd = weekday(iso), month = Number(iso.slice(5, 7));
  const t = (m.times || []).find((r) => r.weekday === wd && (!r.months || r.months.includes(month)));
  return t ? t.hours : '';
}

// planMarkets: [{ name, date: 'YYYY-MM-DD' }] (markets with bowls planned, from the sheet).
// Returns { weekStart, days: [{ date, markets: [{ id, hours }] }] }. days is empty when the Plan
// has no upcoming public markets (e.g. still last week's Plan) → pages show "coming soon".
export function scheduleFromPlan(planMarkets, markets, today = todayNC()) {
  const bySheet = Object.fromEntries(markets.filter((m) => m.sheetName).map((m) => [m.sheetName.toLowerCase(), m]));
  const byDate = {};
  for (const p of planMarkets || []) {
    const m = bySheet[String(p.name || '').trim().toLowerCase()];
    if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(p.date || '') || p.date < today) continue;
    (byDate[p.date] ||= []).push({ id: m.id, hours: hoursFor(m, p.date) });
  }
  const dates = Object.keys(byDate).sort();
  if (!dates.length) return { weekStart: '', days: [] };
  // Only the coming week (a date 7+ days after the first one belongs to a later Plan).
  const first = dates[0];
  const days = dates.filter((d) => d < addDays(first, 7)).map((date) => ({ date, markets: byDate[date] }));
  const weekStart = addDays(first, -((weekday(first) + 6) % 7));   // Monday
  return { weekStart, days };
}

const nextSaturday = (today) => addDays(today, (6 - weekday(today) + 7) % 7);
// One market: tap to show the address and an "Open in Google Maps" button.
const mapsUrl = (m) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([m.name, m.address].filter(Boolean).join(', '));
const card = (m, cls, extra, when) => `<details class="market-row${cls}" style="--dot:${m.color}"><summary><div>${where(m)}${extra}</div><span class="when">${when}</span><span class="chev" aria-hidden="true"></span></summary>` +
  (m.address ? `<div class="market-more"><p>${m.place ? `<strong>${esc(m.place)}</strong><br>` : ''}${esc(m.address)}</p><a class="btn btn-outline btn-sm" href="${mapsUrl(m)}" target="_blank" rel="noopener">Open in Google Maps</a></div>` : '') + '</details>';
const where = (m) => `<div class="name">${esc(m.name)}</div><div class="town">${esc(m.town)}${m.note ? ' · ' + esc(m.note) : ''}</div>`;

// Blocks used by the homepage (same names as the {{placeholders}}).
export function scheduleBlocks(schedule, markets) {
  const days = schedule.days || [];
  const pending = !days.length;
  const active = [];                                   // [{ m, date, hours }] in date order
  days.forEach((d) => d.markets.forEach((s) => { const m = markets.find((x) => x.id === s.id); if (m) active.push({ m, date: d.date, hours: s.hours }); }));
  const onIds = new Set(active.map((a) => a.m.id));
  const sat = nextSaturday(todayNC());
  const dayNames = [...new Set(days.map((d) => fmtDate(d.date, { weekday: 'long', month: 'short', day: 'numeric' })))];
  return {
    marketsIntro: () => pending
      ? "Our lineup changes week to week, and this week's will be posted soon. Here are all the markets where you can find us. Tap one for its address."
      : `Here's where we'll be on <strong>${dayNames.map(esc).join(' and ')}</strong>. Markets in grey aren't on this week's schedule, but you'll find us there on other weeks. Tap a market for its address.`,
    marketsAll: () => {
      const on = active.map((a) => card(a.m, '', '', `${esc(fmtDate(a.date, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${esc(a.hours)}`));
      const rest = markets.filter((m) => !onIds.has(m.id)).map((m) => pending
        ? card(m, '', '', `Sat ${esc(hoursFor(m, sat))}`)
        : card(m, ' off', `<div class="town">Usually Sat ${esc(hoursFor(m, sat))}</div>`, 'Not this week'));
      return on.concat(rest).join('');
    },
  };
}
