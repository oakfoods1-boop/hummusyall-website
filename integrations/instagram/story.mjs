// Saturday market story for Instagram.
//   node story.mjs render [--date YYYY-MM-DD]   → writes public/ig/story-<date>.jpg (+ prints JSON)
//   node story.mjs post   [--date YYYY-MM-DD]   → posts that image (must already be live on the site)
// Lineup comes from https://www.hummusyall.com/api/schedule (the operations sheet Plan tab).
// Posting needs IG_ACCESS_TOKEN (permanent Page token) and IG_USER_ID in the environment.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const SITE = process.env.SITE_URL || 'https://www.hummusyall.com';
const GRAPH = 'https://graph.facebook.com/v26.0';
const STATE = join(here, 'state.json');
const [, , mode = 'render', ...rest] = process.argv;
const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : ''; };

const todayNY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const nextSaturday = (iso) => addDays(iso, (6 - new Date(iso + 'T12:00:00Z').getUTCDay() + 7) % 7);
const shortHours = (h) => String(h || '').replace(/:00/g, '').replace(/\s*–\s*/, ' – ');
const out = (o) => { console.log(JSON.stringify(o)); if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, Object.entries(o).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { flag: 'a' }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const date = arg('--date') || nextSaturday(todayNY());
const file = `public/ig/story-${date}.jpg`;
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};

// ── Weekly variety (Alon, 2026-11-06: "not generic, vary the style every time") ──
// Style, photos and headline all rotate by week number, so two weeks in a row never look the same,
// and a preview made earlier in the week matches what gets posted. Override with --style / --variant.
const STYLES = ['poster', 'polaroid', 'editorial', 'pop', 'chalk', 'collage', 'brand'];
const IMG = (f, pos) => ({ src: `../../public/img/${f}`, pos });
const BOWLS = ['hero.webp', 'bowl-chickpeas.webp', 'bowl-sabich.webp', 'bowl-mushrooms.webp', 'bowl-onions.webp', 'bowl-cauliflower.webp', 'bowl-schug.webp'];
const PHOTOS = {
  brand: [...BOWLS, 'drizzle-closeup.webp'].map((f) => IMG(f, 'center 45%')),
  poster: BOWLS.map((f) => IMG(f)),
  chalk: BOWLS.map((f) => IMG(f)),
  polaroid: [IMG('catering-tent-team.webp', 'center 60%'), IMG('alon-drizzling.webp', 'center 30%'), IMG('market-tasting.webp'), IMG('alon-flambe.webp', 'center 35%'), IMG('team-plating.webp', 'center 45%'), IMG('market-greensboro.webp', 'center 55%'), IMG('alon-mixer.webp', 'center 35%')],
  editorial: [IMG('team-plating.webp', 'center 30%'), IMG('kitchen-cauliflower.webp', 'center 40%'), IMG('drizzle-closeup.webp', 'center 30%'), IMG('alon-flambe.webp', '40% center'), IMG('labeled-bowls.webp', 'center 40%')],
  pop: [IMG('hero.webp', 'center 55%'), IMG('labeled-bowls.webp', 'center 45%'), IMG('market-tasting.webp'), IMG('kitchen-cauliflower.webp', 'center 65%'), IMG('event-spoon.webp'), IMG('bowl-sabich.webp')],
  collage: null, // three photos: one bowl, one people/market shot, one more bowl
};
const PEOPLE = ['catering-tent-team.webp', 'alon-drizzling.webp', 'team-plating.webp', 'market-greensboro.webp', 'alon-flambe.webp', 'drizzle-closeup.webp'];
const HEADS = [
  { kicker: 'This Saturday', line1: 'Find us at', line2: 'the market', cta: "Can't make it? Order for Sunday delivery" },
  { kicker: 'Come hungry', line1: 'Where to', line2: 'find us', cta: 'Order online for Sunday delivery or pickup' },
  { kicker: 'Saturday plans', line1: 'Hummus', line2: 'run!', cta: 'Not around Saturday? We deliver Sundays' },
  { kicker: 'Fresh this week', line1: 'Farmers market', line2: 'schedule', cta: "Can't make it? Order for Sunday delivery" },
  { kicker: 'See you Saturday', line1: 'Grab a bowl', line2: 'near you', cta: 'Or order online for Sunday delivery' },
];
const STYLE_KICKER = { poster: 'Fresh every week', pop: 'Loaded bowls!' }; // short badge texts for the round stamp / sticker
const weekNo = (iso) => Math.floor((Date.parse(iso + 'T12:00:00Z') - Date.parse('2026-01-03T12:00:00Z')) / (7 * 864e5));
function look(iso) {
  const w = weekNo(iso), v = Number(arg('--variant') || 0);
  const style = arg('--style') || STYLES[(((w + v) % STYLES.length) + STYLES.length) % STYLES.length];
  const pick = (a, k = 1) => a[(((w * k + v) % a.length) + a.length) % a.length];
  const photos = style === 'collage'
    ? [IMG(pick(BOWLS)), IMG(pick(PEOPLE), 'center 40%'), IMG(pick(BOWLS, 3) === pick(BOWLS) ? BOWLS[(w + 2) % BOWLS.length] : pick(BOWLS, 3))]
    : [pick(PHOTOS[style], 3)];
  const head = { ...pick(HEADS, 2) };
  if (STYLE_KICKER[style]) head.kicker = STYLE_KICKER[style];
  return { style, photos, head, cta: head.cta };
}

if (mode === 'render') {
  // SCHEDULE_FILE: a saved /api/schedule JSON, for previews made away from the site.
  const sched = process.env.SCHEDULE_FILE ? JSON.parse(readFileSync(process.env.SCHEDULE_FILE, 'utf8'))
    : await (await fetch(`${SITE}/api/schedule`, { headers: { 'cache-control': 'no-cache' } })).json();
  const day = (sched.days || []).find((d) => d.date === date);
  if (!day || !day.markets.length) { out({ status: 'no-markets', date }); process.exit(0); }
  const L = look(date);
  const data = {
    ...L,
    date: new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }),
    markets: day.markets.map((m) => ({ name: m.name, color: m.color, hours: shortHours(m.hours), town: m.storyTown || String(m.town || '').replace(/,\s*NC$/, '') })),
  };
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + join(here, 'story.html'));
  await page.evaluate((d) => window.fill(d), data);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const fits = await page.evaluate(() => window.fit());
  const outFile = arg('--out') || file;
  mkdirSync(dirname(resolve(root, outFile)), { recursive: true });
  await page.screenshot({ path: resolve(root, outFile), type: 'jpeg', quality: 90 });
  await browser.close();
  out({ status: fits ? 'rendered' : 'rendered-overflow', date, file: outFile, style: L.style, markets: day.markets.length, posted: state.lastStory === date ? 'yes' : 'no' });
} else if (mode === 'post') {
  const token = process.env.IG_ACCESS_TOKEN, ig = process.env.IG_USER_ID;
  if (!token || !ig) throw new Error('IG_ACCESS_TOKEN / IG_USER_ID missing');
  if (state.lastStory === date && !rest.includes('--again')) { out({ status: 'already-posted', date }); process.exit(0); }
  const url = `${SITE}/ig/story-${date}.jpg`;
  // Wait for Cloudflare to finish deploying the image (usually about a minute).
  for (let i = 0; ; i++) {
    const r = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (r && r.ok && (r.headers.get('content-type') || '').includes('image')) break;
    if (i > 40) throw new Error('image never went live: ' + url);
    await sleep(15000);
  }
  const call = async (path, params) => {
    const r = await fetch(`${GRAPH}/${path}`, { method: 'POST', body: new URLSearchParams({ ...params, access_token: token }) });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(`${path}: ${j.error ? j.error.message : r.status}`);
    return j;
  };
  const { id: container } = await call(`${ig}/media`, { media_type: 'STORIES', image_url: url });
  for (let i = 0; i < 30; i++) {
    const s = await (await fetch(`${GRAPH}/${container}?fields=status_code&access_token=${encodeURIComponent(token)}`)).json();
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR') throw new Error('Instagram could not process the image');
    await sleep(5000);
  }
  const { id } = await call(`${ig}/media_publish`, { creation_id: container });
  writeFileSync(STATE, JSON.stringify({ ...state, lastStory: date, lastStoryId: id, lastStoryStyle: look(date).style }, null, 2) + '\n');
  out({ status: 'posted', date, media: id });
} else {
  throw new Error('mode must be render or post');
}
