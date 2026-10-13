// Builds the site into dist/. No dependencies: run with `node build.mjs`.
// Pages live in src/pages, shared pieces in src/partials, content in data/*.json.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const root = dirname(new URL(import.meta.url).pathname);
const PREVIEW = process.argv.includes('--preview');
const dist = join(root, PREVIEW ? 'dist-preview' : 'dist');
const read = (p) => readFileSync(join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const site = json('data/site.json');
const menu = json('data/menu.json');
const { markets } = json('data/markets.json');
const schedule = json('data/schedule.json');
const marketById = Object.fromEntries(markets.map((m) => [m.id, m]));

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => '$' + (Number.isInteger(n) ? n : n.toFixed(2));
const img = (name, alt, cls = '', extra = '') =>
  `<img src="/img/${name}.webp" alt="${esc(alt)}"${cls ? ` class="${cls}"` : ''} loading="lazy" decoding="async"${extra}>`;
const fmtDate = (iso, opts) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { timeZone: 'America/New_York', ...opts });

// ---------- blocks that pages can drop in with {{name}} ----------
const blocks = {
  bowlCards: () => menu.bowls.filter((b) => b.available).map((b) => `
      <article class="card">
        ${img(b.image, b.name, 'card-img', ' width="700" height="525"')}
        <div class="card-title"><h3>${esc(b.name)}</h3><span class="price">${money(b.price)}</span></div>
        <p>${esc(b.description)}</p>
        <a class="btn btn-outline" href="/order/#${b.id}">Add to order</a>
      </article>`).join(''),

  dipCards: () => menu.extras.filter((x) => x.available && x.image).map((x) => `
      <article class="card dip-card">
        ${img(x.image, x.name + ' label', '', ' width="190" height="190"')}
        <h3>${esc(x.name)}</h3>
        <p class="dip-sub">${esc(x.subtitle)}</p>
        <p>${esc(x.description)}</p>
        <span class="price">${esc(x.size)} · ${money(x.price)}</span>
      </article>`).join(''),

  // Homepage: the next market day's lineup
  marketsNext: () => {
    const day = schedule.days[0];
    if (!day) return '<p>Check back soon for this week\'s markets.</p>';
    return day.markets.map((s) => {
      const m = marketById[s.id];
      return `<div class="market-row" style="--dot:${m.color}"><div><div class="name">${esc(m.name)}</div><div class="town">${esc(m.town)}${m.note ? ' · ' + esc(m.note) : ''}</div></div><span class="when">${esc(s.hours)}</span></div>`;
    }).join('');
  },
  marketsNextDay: () => schedule.days[0] ? fmtDate(schedule.days[0].date, { weekday: 'long', month: 'short', day: 'numeric' }) : 'this week',

  // Markets page: every day this week, then every market we sell at
  weekSchedule: () => schedule.days.map((d) => `
      <div class="week-day">
        <h3>${fmtDate(d.date, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
        <div class="market-list">${d.markets.map((s) => {
          const m = marketById[s.id];
          return `<div class="market-row" style="--dot:${m.color}"><div><div class="name">${esc(m.name)}</div><div class="town">${esc(m.town)}${m.note ? ' · ' + esc(m.note) : ''}</div></div><span class="when">${esc(s.hours)}</span></div>`;
        }).join('')}</div>
      </div>`).join(''),
  weekLabel: () => {
    const start = schedule.weekStart;
    const end = new Date(new Date(start + 'T12:00:00').getTime() + 6 * 864e5).toISOString().slice(0, 10);
    return `${fmtDate(start, { month: 'long', day: 'numeric' })} – ${fmtDate(end, { month: 'long', day: 'numeric', year: 'numeric' })}`;
  },
  allMarkets: () => {
    const thisWeek = new Set(schedule.days.flatMap((d) => d.markets.map((s) => s.id)));
    return markets.map((m) => `
      <div class="market-row${thisWeek.has(m.id) ? '' : ' off'}" style="--dot:${m.color}">
        <div><div class="name">${esc(m.name)}</div><div class="town">${esc(m.town)}${m.note ? ' · ' + esc(m.note) : ''}</div><div class="town">${m.hours.map(esc).join('<br>')}</div></div>
        <span class="when">${thisWeek.has(m.id) ? 'This week' : 'Not this week'}</span>
      </div>`).join('');
  },

  // Data handed to the browser scripts
  pageData: () => `<script>window.HY=${JSON.stringify({
    site: { fulfillmentWeekday: site.fulfillmentWeekday, orderCutoff: site.orderCutoff, skipDates: site.skipDates, ordersOpen: site.ordersOpen, ordersClosedMessage: site.ordersClosedMessage, pickupLocation: site.pickupLocation, deliveryFee: site.deliveryFee },
    menu: { bowls: menu.bowls.filter((b) => b.available), extras: menu.extras.filter((x) => x.available) },
    markets, schedule,
  }).replace(/</g, '\\u003c')}</script>`,

  email: () => site.email,
  instagram: () => site.instagram,
  facebook: () => site.facebook,
  pickupLocation: () => esc(site.pickupLocation),
  deliveryArea: () => esc(site.deliveryArea),
  year: () => String(new Date().getFullYear()),
};

// ---------- page assembly ----------
const layout = read('src/partials/layout.html');
const partials = Object.fromEntries(readdirSync(join(root, 'src/partials')).map((f) => [f.replace('.html', ''), read('src/partials/' + f)]));

function fill(html, vars, depth = 0) {
  if (depth > 5) return html;
  return html.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, n) => fill(partials[n] ?? '', vars, depth + 1))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, n) => (n in vars ? vars[n] : n in blocks ? blocks[n]() : all));
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'public'), dist, { recursive: true });

const pages = [];
for (const file of readdirSync(join(root, 'src/pages'))) {
  const src = read('src/pages/' + file);
  const m = src.match(/^<!--(\{[\s\S]*?\})-->\s*/);
  if (!m) throw new Error(`${file}: missing settings comment at the top`);
  const meta = JSON.parse(m[1]);
  const body = src.slice(m[0].length);
  const navFlags = Object.fromEntries(['home', 'menu', 'order', 'markets', 'catering', 'about', 'jobs'].map((k) => [`nav_${k}`, meta.nav === k ? ' aria-current="page"' : '']));
  const vars = {
    title: esc(meta.title), description: esc(meta.description), path: meta.path,
    canonical: site.url + meta.path, bodyClass: meta.bodyClass || '', extraHead: meta.extraHead || '',
    extraScripts: meta.extraScripts || '', ...navFlags,
  };
  vars.content = fill(body, vars);
  const html = fill(layout, vars);
  if (/\{\{\s*[\w.>]/.test(html)) throw new Error(`${file}: unfilled placeholder ${html.match(/\{\{[^}]*\}\}/)[0]}`);
  const outDir = meta.path === '/' ? dist : join(dist, meta.path);
  let finalHtml = html;
  if (PREVIEW) {
    // Preview copy: relative links so it works from any address (no server functions).
    const depth = meta.file ? 0 : meta.path.split('/').filter(Boolean).length;
    const up = '../'.repeat(depth) || './';
    finalHtml = html
      .replace(/(href|src)="\/(?!\/)([^"]*)"/g, (all, attr, rest) => {
        let [path, hash] = rest.split('#');
        if (attr === 'href' && (path === '' || path.endsWith('/'))) path += 'index.html';
        return `${attr}="${up}${path}${hash !== undefined ? '#' + hash : ''}"`;
      })
      .replace('<head>', `<head>\n<script>window.HY_BASE=${JSON.stringify(up)}</script>`);
  }
  const outFile = meta.file ? join(dist, meta.file) : join(outDir, 'index.html');
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, finalHtml);
  if (!meta.noindex) pages.push(meta.path);
}

// SEO + hosting files
writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${site.url}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site.url}/sitemap.xml\n`);
if (existsSync(join(root, 'src/_redirects'))) cpSync(join(root, 'src/_redirects'), join(dist, '_redirects'));
if (existsSync(join(root, 'src/_headers'))) cpSync(join(root, 'src/_headers'), join(dist, '_headers'));

console.log(`Built ${pages.length} pages into dist/`);
