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

const row = (m, when) => `<div class="market-row" style="--dot:${m.color}"><div><div class="name">${esc(m.name)}</div><div class="town">${esc(m.town)}${m.note ? ' · ' + esc(m.note) : ''}</div></div><span class="when">${esc(when)}</span></div>`;
const nextSaturday = (today) => addDays(today, (6 - weekday(today) + 7) % 7);
const regular = (markets) => { const sat = nextSaturday(todayNC()); return markets.map((m) => row(m, 'Sat ' + hoursFor(m, sat))).join(''); };

// Blocks used by the pages (same names as the {{placeholders}}).
export function scheduleBlocks(schedule, markets) {
  const byId = Object.fromEntries(markets.map((m) => [m.id, m]));
  const days = schedule.days || [];
  const pending = !days.length;
  return {
    marketsNextDay: () => pending ? 'Saturday' : fmtDate(days[0].date, { weekday: 'long', month: 'short', day: 'numeric' }),
    marketsNext: () => pending
      ? `<p class="note">This week's lineup will be posted soon. These are our regular Saturday markets:</p>${regular(markets)}`
      : days[0].markets.map((s) => row(byId[s.id], s.hours)).join(''),
    weekLabel: () => pending ? 'schedule coming soon'
      : `${fmtDate(schedule.weekStart, { month: 'long', day: 'numeric' })} – ${fmtDate(addDays(schedule.weekStart, 6), { month: 'long', day: 'numeric', year: 'numeric' })}`,
    weekSchedule: () => pending
      ? `<div class="week-day"><h3>This week</h3><p class="note">This week's lineup will be posted soon. Check back in a day or two, or see all our markets below.</p></div>`
      : days.map((d) => `
      <div class="week-day">
        <h3>${fmtDate(d.date, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
        <div class="market-list">${d.markets.map((s) => row(byId[s.id], s.hours)).join('')}</div>
      </div>`).join(''),
    allMarkets: () => {
      const thisWeek = new Set(days.flatMap((d) => d.markets.map((s) => s.id)));
      return markets.map((m) => `
      <div class="market-row${pending || thisWeek.has(m.id) ? '' : ' off'}" style="--dot:${m.color}">
        <div><div class="name">${esc(m.name)}</div><div class="town">${esc(m.town)}${m.note ? ' · ' + esc(m.note) : ''}</div><div class="town">${m.hours.map(esc).join('<br>')}</div></div>
        <span class="when">${pending ? '' : thisWeek.has(m.id) ? 'This week' : 'Not this week'}</span>
      </div>`).join('');
    },
  };
}
