# Hummus Y'all website

Source for www.hummusyall.com. A plain static site (no framework) hosted on Cloudflare Pages, with two small server functions for Square checkout and the contact forms.

## Everyday changes

| To change | Edit |
|---|---|
| Prices, bowl descriptions, sold-out items | `data/menu.json` (`available: false` hides an item) |
| This week's farmers markets (homepage) | Automatic: the Plan tab of the market operations sheet (markets with bowls planned). Market names/hours: `data/markets.json` |
| Market list, pins, seasonal hours | `data/markets.json` |
| Skip a Sunday, pause orders, delivery fee, pickup town | `data/site.json` |
| Page text | `src/pages/*.html` |
| Header / footer | `src/partials/` |
| Colors, fonts, spacing | `public/css/site.css` (`:root` at the top) |
| Photos | `public/img/` (webp, under ~150 KB each) |

The next delivery date ("Sunday, Oct 18") is calculated automatically: orders placed through Saturday 11:59 PM (NC time) go to the coming Sunday. Add dates to `skipDates` to skip a week.

## Build and run locally

```
npm install
npm run build     # writes dist/
npm run dev       # builds and serves at http://localhost:8788 with the server functions
node build.mjs --preview   # relative-link copy in dist-preview/ for previews
```

## Hosting (Cloudflare Pages)

- Build command: `node build.mjs` · Output directory: `dist`
- Environment variables (Settings > Environment variables):
  - `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID` (and `SQUARE_ENV=sandbox` while testing) for checkout
  - `FORM_WEBHOOK_URL`, `FORM_SECRET` for the catering and job forms (see `integrations/forms-to-sheet.gs`)
- `src/_redirects` sends old Squarespace addresses (/shop, /new-page-2, /team…) to the new pages.

## How ordering works

The order page builds a cart in the browser and posts it to `/api/checkout` (`functions/api/checkout.js`). The function looks up prices in `data/menu.json`, creates a Square payment link with the pickup/delivery date in the order note, and sends the customer to Square to pay. Orders show up in the Square dashboard like market sales.
