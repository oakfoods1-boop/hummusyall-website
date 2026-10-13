# Notes for Claude

- Owner: Alon (Hummus Y'all / Oak Foods LLC). Non-developer; explain changes in plain words, deliver a preview before going live.
- Content lives in `data/*.json`; pages in `src/pages` (first line is a JSON settings comment); build with `node build.mjs`. Never edit `dist/`.
- Design: design "A · Market Fresh" — cream #FBF6EC, olive #2F4A2A, paprika #C8502A buttons, lime #DFE777 highlights; Bricolage Grotesque headings, Poppins body. Tokens in `public/css/site.css` `:root`.
- Checkout prices come only from `data/menu.json` (server side). Keep it that way.
- Test locally with `npm run dev` and screenshot at 390px and 1366px before pushing. No horizontal scroll on phones.
- Preview for Alon: `node build.mjs --preview` then publish `dist-preview` as an artifact (root page = dist-preview/index.html with head/body inlined).
- Keep testimonials verbatim; don't invent claims about ingredients or allergens — ask Alon.
- Weekly availability: items with a `plan` field in `data/menu.json` are hidden ("Not available this week") when that column's TOTAL on the ops sheet Plan tab is 0. Read via the forms Apps Script (`action:'availability'`, integrations/forms-to-sheet.gs), cached 5 min; if the sheet can't be read, nothing is blocked.
- Weekly markets: one homepage section (#markets; /markets/ redirects there) lists all markets (tap for address + Google Maps link; no map), this week's first, others greyed. Lineup comes live from the Plan tab (markets with bowls > 0, date = column Q or B4) via `functions/_middleware.js` + `lib/schedule.mjs`; only markets with a `sheetName` in `data/markets.json` show. Built pages carry the "coming soon" fallback.
