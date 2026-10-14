// Renders brochure HTML to PDF + PNG previews, and reports any page whose content overflows.
import { chromium } from '/tmp/claude-0/-home-claude-hummusyall-website/5c3ab7b0-c51e-50cc-a8a7-74092005d3e8/scratchpad/pw/node_modules/playwright/index.mjs';
const [, , name] = process.argv;
const dir = new URL('.', import.meta.url).pathname;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
await p.goto('file://' + dir + name + '.html');
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(500);
const report = await p.evaluate(() => [...document.querySelectorAll('.page')].map((pg, i) => {
  const box = pg.getBoundingClientRect();
  const bad = [];
  pg.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width && (r.bottom > box.bottom + 0.5 || r.right > box.right + 0.5)) bad.push(el.className || el.tagName);
  });
  const foot = pg.querySelector('.footer'); const prev = foot && foot.previousElementSibling;
  const gap = foot && prev ? Math.round(foot.getBoundingClientRect().top - prev.getBoundingClientRect().bottom) : null;
  return { page: i + 1, overflow: [...new Set(bad)].slice(0, 8), spaceAboveFooterPx: gap };
}));
console.log(JSON.stringify(report));
const pages = await p.$$('.page');
for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: `${dir}${name}-p${i + 1}.png` });
await p.emulateMedia({ media: 'print' });
await p.pdf({ path: `${dir}${name}.pdf`, preferCSSPageSize: true, printBackground: true });
await b.close();
