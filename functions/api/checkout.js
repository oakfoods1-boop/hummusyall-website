// POST /api/checkout  { items: [{id, qty}], mode: "delivery" | "pickup" }
// Builds a Square payment link from the cart and returns { url }. Prices always come from data/menu.json,
// never from the browser, so nobody can change what they pay.
//
// Needs these settings in Cloudflare Pages (Settings > Environment variables):
//   SQUARE_ACCESS_TOKEN  - from the Square Developer dashboard (production access token)
//   SQUARE_LOCATION_ID   - the Square location that should receive online orders
//   SQUARE_ENV           - "production" (default) or "sandbox" for testing
import menu from '../../data/menu.json';
import site from '../../data/site.json';
import { nextFulfillment, prettyDate } from '../_lib/fulfillment.js';
import { getAvailability } from '../_lib/availability.js';

// Noon in North Carolina on the given YYYY-MM-DD, as an RFC 3339 timestamp (handles daylight saving).
const noonNC = (iso) => {
  const probe = new Date(iso + 'T16:00:00Z');
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' })
    .formatToParts(probe).find((p) => p.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';
  return `${iso}T12:00:00${off}`;
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) {
    return json({ error: 'Online checkout is being set up and will open soon.' }, 503);
  }
  if (site.ordersOpen === false) return json({ error: site.ordersClosedMessage }, 409);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (body.mode !== 'pickup' && body.mode !== 'delivery') return json({ error: 'Please choose delivery or pickup.' }, 400);
  const mode = body.mode;
  const catalog = Object.fromEntries([...menu.bowls, ...menu.extras].filter((i) => i.available).map((i) => [i.id, i]));
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((i) => ({ item: catalog[i.id], qty: Math.floor(Number(i.qty)) }))
    .filter((i) => i.item && i.qty > 0 && i.qty <= 50);
  if (!items.length) return json({ error: 'Your order is empty.' }, 400);

  // Items not being made this week (Plan tab of the operations sheet).
  const { unavailable } = await getAvailability(env, waitUntil);
  const out = items.filter((i) => unavailable.includes(i.item.id)).map((i) => i.item.name);
  if (out.length) {
    return json({ error: `Sorry, ${out.join(' and ')} ${out.length > 1 ? "aren't" : "isn't"} available this week. Please remove ${out.length > 1 ? 'them' : 'it'} from your order.`, unavailable: items.filter((i) => unavailable.includes(i.item.id)).map((i) => i.item.id) }, 409);
  }

  const zips = (site.deliveryZips || []).map(String);
  const zip = String(body.zip || '').replace(/\D/g, '').slice(0, 5);
  if (mode === 'delivery' && zips.length && !zips.includes(zip)) {
    return json({ error: zip ? `Sorry, we don't deliver to ${zip} yet. Please choose pickup instead.` : 'Please enter your delivery ZIP code.' }, 400);
  }

  const date = nextFulfillment(site);
  if (!date) return json({ error: 'No upcoming fulfillment date is open right now.' }, 409);
  const when = prettyDate(date);

  // Item notes show on Square's emailed receipt (when "Show item notes" is on in Square's receipt settings).
  // The first item also tells the customer to expect our follow-up email.
  const followUp = mode === 'pickup'
    ? `Pickup ${when}${site.pickupWindow ? ', ' + site.pickupWindow : ''} in ${site.pickupLocation}. Once your order is ready, we'll email you the pickup address and instructions.`
    : `Delivery ${when}${site.deliveryWindow ? ', ' + site.deliveryWindow : ''}. We'll email you when your order is on its way. Not home? Leave a cooler outside.`;
  const lineItems = items.map(({ item, qty }, i) => ({
    name: item.name + (item.size ? ` (${item.size})` : ''),
    quantity: String(qty),
    base_price_money: { amount: Math.round(item.price * 100), currency: 'USD' },
    note: i === 0 ? followUp : `${mode === 'pickup' ? 'Pickup' : 'Delivery'} ${when}.`,
  }));
  if (mode === 'delivery' && site.deliveryFee) {
    lineItems.push({ name: 'Delivery', quantity: '1', base_price_money: { amount: Math.round(site.deliveryFee * 100), currency: 'USD' } });
  }

  const origin = new URL(request.url).origin;
  const base = env.SQUARE_API_BASE || (env.SQUARE_ENV === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com');
  const res = await fetch(base + '/v2/online-checkout/payment-links', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2025-01-23',
    },
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      description: `Hummus Y'all online order: ${mode} ${when}`,
      order: {
        location_id: env.SQUARE_LOCATION_ID,
        reference_id: `web-${date}-${mode}`,
        line_items: lineItems,
        // Order-level taxes from data/site.json apply to every item automatically.
        taxes: (site.taxes || []).map((t, i) => ({ uid: `tax-${i}`, name: t.name, percentage: String(t.percentage), type: 'ADDITIVE', scope: 'ORDER' })),
        source: { name: 'hummusyall.com' },
        // Pickup/delivery details so the order shows on Square's Orders screen; the customer's
        // name, email, phone (and address for delivery) are filled in by Square at checkout.
        fulfillments: [mode === 'pickup'
          ? { type: 'PICKUP', state: 'PROPOSED', pickup_details: { schedule_type: 'SCHEDULED', pickup_at: noonNC(date), note: `Pickup in ${site.pickupLocation} on ${when}` } }
          : { type: 'SHIPMENT', state: 'PROPOSED', shipment_details: { shipping_note: `Local delivery on ${when}` } }],
      },
      checkout_options: {
        ask_for_shipping_address: mode === 'delivery',
        redirect_url: `${origin}/order/thanks/`,
        merchant_support_email: site.email,
        allow_tipping: false,
      },
      payment_note: `${mode === 'pickup' ? `PICKUP in ${site.pickupLocation}` : `DELIVERY${zip ? ` (ZIP ${zip})` : ''}`} on ${when}`,
      // Start Square's address form with the ZIP the customer gave us.
      ...(mode === 'delivery' && zip ? { pre_populated_data: { buyer_address: { postal_code: zip, country: 'US' } } } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.payment_link?.url) {
    console.log('Square error', res.status, JSON.stringify(data.errors || data));
    return json({ error: 'Checkout is temporarily unavailable.' }, 502);
  }
  return json({ url: data.payment_link.url });
}
