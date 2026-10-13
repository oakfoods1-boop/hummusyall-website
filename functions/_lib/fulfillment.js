// Same rule as the website: the next fulfillment day (Sunday) whose order cutoff hasn't passed, in North Carolina time.
export function nextFulfillment(site, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const nc = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute));
  const wd = site.fulfillmentWeekday ?? 0;
  const cut = site.orderCutoff ?? { weekday: 6, hour: 23, minute: 59 };
  const skip = site.skipDates ?? [];
  for (let i = 0; i < 35; i++) {
    const d = new Date(Date.UTC(nc.getUTCFullYear(), nc.getUTCMonth(), nc.getUTCDate() + i));
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== wd || skip.includes(iso)) continue;
    const back = (wd - cut.weekday + 7) % 7;
    const cutoff = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back, cut.hour, cut.minute, 59));
    if (nc <= cutoff) return iso;
  }
  return null;
}

export function prettyDate(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
}
