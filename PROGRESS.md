# Website project progress

_Last updated: October 13, 2026_

## Done
- New site built (home, order, markets, catering, our story, jobs, thank-you, 404) in design "A · Market Fresh", with Alon's photos and logo.
- Hosted on Cloudflare Pages: **https://hummusyall-website.pages.dev** (updates automatically from GitHub `main`).
- Square checkout connected (secrets `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID` set in Cloudflare). Verified a real payment page opens.
- Sales tax on every order: NC State 4.75% + Wake County 2% + Wake County Transit 0.5% (`data/site.json`).
- Delivery fee $8, Cary pickup free, tips turned off.
- Dips added: The green stuff 8 oz $12, Baba Ganoush 8 oz $8, Garlic Aioli 8 oz $8.
- Old Squarespace links redirect (/shop, /new-page-2, /team, /contact-6, /gallery-1).

## Next steps (in order)
1. **Test order** – Alon places a $2.15 extra-pita pickup order on the test site, checks it in Square, refunds it.
2. **Forms** – create the "Website Inquiries" Google Sheet with `integrations/forms-to-sheet.gs`, then add `FORM_WEBHOOK_URL` and `FORM_SECRET` in Cloudflare.
3. **Alon's design comments** – collect and apply.
4. **Content to confirm with Alon**
   - Which markets this Saturday (Oct 17) – currently a copy of last week's lineup in `data/schedule.json`
   - Bowl descriptions in `data/menu.json` (written from photos)
   - Order cutoff (currently Saturday 11:59 PM for Sunday)
   - Team members OK appearing in kitchen photos
   - Accountant: county tax rate for Durham/Orange deliveries, tax on the delivery fee
5. **Files from Alon** – catering brochure PDF and workshop flyer PDF → `public/files/` (links already on the catering page).
6. **Square** – optional: change customer-facing business name from "Oak Foods LLC" to "Hummus Y'all".
7. **Launch** – add hummusyall.com as a custom domain in Cloudflare Pages, update DNS at Squarespace Domains, verify, then cancel the Squarespace site plan (keep the domain).

## Later
- Connect the weekly market schedule to the market-ops Google Sheet so it updates itself.
- Real photos of the three dips (replace label images).
