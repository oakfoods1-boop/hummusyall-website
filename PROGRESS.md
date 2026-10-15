# Website project progress

_Last updated: October 14, 2026 (site live)_

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
3. **Alon's design comments** – applied Oct 13: delivery/pickup choice, menu + markets follow the ops sheet Plan, one market list on the homepage (tap for address), new photos + hero video, dip Add-to-order buttons, Thursday 11:59 PM cutoff, receipt note. More comments welcome any time.
4. **Content to confirm with Alon**
   - ~~Which markets this Saturday~~ – done: markets now come from the ops sheet Plan tab automatically
   - Bowl descriptions in `data/menu.json` (written from photos)
   - Team members OK appearing in kitchen photos
   - Accountant: county tax rate for Durham/Orange deliveries, tax on the delivery fee
5. ~~Files from Alon~~ – done Oct 13: brochure and flyer redesigned and in `public/files/` (sources in `integrations/brochures/`).
6. **Square** – optional: change customer-facing business name from "Oak Foods LLC" to "Hummus Y'all".
7. ~~Launch~~ – **LIVE Oct 14, 2026**: DNS moved to Cloudflare (nameservers peaches/sri.ns.cloudflare.com; registration stays at Squarespace Domains), hummusyall.com + www on the Pages project, Google Workspace MX + TXT kept. Squarespace *website* plan (Commerce Basic) cancelled Oct 14, 2026 — expires May 22, 2027, no more charges; Domains + Google Workspace subscriptions stay active. SPF + DMARC added. Optional: export Squarespace orders CSV before May 2027; DKIM.

## Orders & notifications (added Oct 13)
- Private orders page `/admin/orders/` built: lists paid website orders per Sunday, prep totals, Ready for pickup / On its way buttons that email the customer through the Google script (`action: notify`) and mark the order PREPARED in Square.
- Switched on Oct 13: Google script updated (version 2 of the same deployment), `ADMIN_PASSWORD` set in Cloudflare, pickup 800 Roni Ct, Cary, NC 27519, Sundays 9 AM – 2 PM; delivery between 9 AM and 2 PM (`data/site.json`). Pending: Alon's first real test of the Ready email.

## Ops sheet (Oct 14)
- Ops sheet script v6 pasted: website orders sync into Pickups/Deliveries every 15 min (+ menu "Sync website orders now") from `/api/ops/orders` (key = FORM_SECRET); Squarespace CSV rows kept side by side; customer comments go to Customer notes. Source: `integrations/ops-sheet/`.
- Order page has an optional customer comment (saved on the Square order as metadata `customer_note`).

## Later
- **Replace the ops sheet's Pickups/Deliveries tabs** (Alon's goal):
  - Option 1 (recommended at launch): the market-ops sheet pulls paid website orders from Square automatically (every 15 min + menu button) into the existing Pickups/Deliveries tabs, same columns, keeps Done ticks; replaces the Squarespace CSV import. Plan row "Pickup / Pre-orders" keeps working.
  - Option 2 (after a few Sundays): staff view of the orders page with a contractor password (names, phones, addresses, items; no emails, no totals), Ready / Picked up / On its way / Delivered buttons that notify customers; production counts feed Plan; then delete the two tabs.
- Connect the weekly market schedule to the market-ops Google Sheet so it updates itself.
- Real photos of the three dips (replace label images).

## Checkout fix (Oct 15)
- A customer saw "Unexpected token '<' … is not valid JSON": /api/checkout answered with an HTML page (Cloudflare security check or crash page) instead of JSON. Code itself worked locally.
- Fix: /api/checkout never crashes into HTML (try/catch, 500 JSON). The order page reads the reply as text; if it isn't JSON (or the request fails at network level) it re-sends the order as a normal form post (`payload` field), which can pass a Cloudflare check; the server then redirects (303) to Square, or back to /order/?checkout_error=… which the page shows.
- To check in Cloudflare: Security → Events for hummusyall.com around Oct 15 7 PM, and Pages → Functions logs.
