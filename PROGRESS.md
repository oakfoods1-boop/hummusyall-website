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
1. ~~Test order~~ – done Oct 13: real order, thank-you page, Square note and refund all worked.
2. ~~Forms~~ – done Oct 13: catering and job forms go to the Google Sheet "Hummus Y'all Website Inquiries" (one tab per form) and email alon@hummusyall.com. `FORM_WEBHOOK_URL` and `FORM_SECRET` set in Cloudflare.
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

## Orders & notifications (added Oct 13)
- Private orders page `/admin/orders/` built: lists paid website orders per Sunday, prep totals, Ready for pickup / On its way buttons that email the customer through the Google script (`action: notify`) and mark the order PREPARED in Square.
- To switch on: Alon updates the Google script (new version of the existing deployment), adds `ADMIN_PASSWORD` in Cloudflare, sends the Cary pickup address + Sunday pickup window (+ delivery window) for `data/site.json`.

## Later
- **Replace the ops sheet's Pickups/Deliveries tabs** (Alon's goal):
  - Option 1 (recommended at launch): the market-ops sheet pulls paid website orders from Square automatically (every 15 min + menu button) into the existing Pickups/Deliveries tabs, same columns, keeps Done ticks; replaces the Squarespace CSV import. Plan row "Pickup / Pre-orders" keeps working.
  - Option 2 (after a few Sundays): staff view of the orders page with a contractor password (names, phones, addresses, items; no emails, no totals), Ready / Picked up / On its way / Delivered buttons that notify customers; production counts feed Plan; then delete the two tabs.
- Connect the weekly market schedule to the market-ops Google Sheet so it updates itself.
- Real photos of the three dips (replace label images).
