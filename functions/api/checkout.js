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
import { extrasStatus } from '../_lib/extras.js';

// Noon in North Carolina on the given YYYY-MM-DD, as an RFC 3339 timestamp (handles daylight saving).
const noonNC = (iso) => {
  const probe = new Date(iso + 'T16:00:00Z');
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' })
    .formatToParts(probe).find((p) => p.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';
  return `${iso}T12:00:00${off}`;
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Two ways in:
//  - the order page's normal JSON request (answers { url } or { error }), and
//  - a plain form post (field "payload" = the same JSON). The page falls back to this when the JSON
//    request gets something other than JSON back (for example a Cloudflare security check page):
//    as a full page load the browser can pass that check, and we answer with a redirect to Square,
//    or back to the order page with the error message.
export async function onRequestPost(ctx) {
  const isForm = !(ctx.request.headers.get('content-type') || '').includes('application/json');
  let res;
  try {
    let body = null;
    if (isForm) {
      try { body = JSON.parse(String((await ctx.request.formData()).get('payload') || '')); } catch { body = null; }
    } else {
      try { body = await ctx.request.json(); } catch { body = null; }
    }
    res = body && typeof body === 'object' ? await checkout(ctx, body) : json({ error: 'Invalid request.' }, 400);
  } catch (e) {
    // Never let a crash turn into Cloudflare's HTML error page.
    console.log('checkout crashed', e && e.stack || e);
    res = json({ error: `Checkout is temporarily unavailable (ref: ${String(e && e.name || 'crash').slice(0, 40)}).` }, 500);
  }
  if (!isForm) return res;
  const data = await res.clone().json().catch(() => ({}));
  const origin = new URL(ctx.request.url).origin;
  const to = data.url || `${origin}/order/?checkout_error=${encodeURIComponent(data.error || 'Checkout is temporarily unavailable.')}`;
  return new Response(null, { status: 303, headers: { Location: to, 'Cache-Control': 'no-store' } });
}

async function checkout({ request, env, waitUntil }, body) {
  if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) {
    return json({ error: 'Online checkout is being set up and will open soon.' }, 503);
  }
  if (site.ordersOpen === false) return json({ error: site.ordersClosedMessage }, 409);

  if (body.mode !== 'pickup' && body.mode !== 'delivery') return json({ error: 'Please choose delivery or pickup.' }, 400);
  const mode = body.mode;
  const catalog = Object.fromEntries([...menu.bowls, ...menu.extras].filter((i) => i.available).map((i) => [i.id, i]));
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((i) => ({ item: catalog[i.id], qty: Math.floor(Number(i.qty)) }))
    .filter((i) => i.item && i.qty > 0 && i.qty <= 50);
  if (!items.length) return json({ error: 'Your order is empty.' }, 400);

  // Which day: the usual Sunday, or one of the extra days with leftover bowls (functions/_lib/extras.js).
  const sunday = nextFulfillment(site);
  const asked = /^\d{4}-\d{2}-\d{2}$/.test(String(body.day || '')) ? String(body.day) : '';
  const extraDay = asked && asked !== sunday;
  let date = sunday, windowText = '';
  if (extraDay) {
    const extras = await extrasStatus(env);
    if (!extras || !extras.days.includes(asked)) {
      return json({ error: 'Sorry, that day is no longer available. Please choose another day.', dayClosed: true }, 409);
    }
    const left = (id) => ((extras.unlimited || []).includes(id) ? 50 : extras.remaining[id] || 0);
    const none = items.filter((i) => left(i.item.id) === 0).map((i) => i.item.name);
    const short = items.filter((i) => left(i.item.id) > 0 && left(i.item.id) < i.qty);
    if (none.length || short.length) {
      const parts = [];
      if (none.length) parts.push(`${none.join(' and ')} ${none.length > 1 ? "aren't" : "isn't"} available that day`);
      if (short.length) parts.push('we only have ' + short.map((i) => `${left(i.item.id)} × ${i.item.name}`).join(' and ') + ' left');
      return json({ error: `Sorry, ${parts.join(', and ')}. Please change your order.`, remaining: extras.remaining, unlimited: extras.unlimited || [] }, 409);
    }
    date = asked;
    windowText = extras.window;
  } else {
    // Items not being made this week (Plan tab of the operations sheet).
    const { unavailable } = await getAvailability(env, waitUntil);
    const out = items.filter((i) => unavailable.includes(i.item.id)).map((i) => i.item.name);
    if (out.length) {
      return json({ error: `Sorry, ${out.join(' and ')} ${out.length > 1 ? "aren't" : "isn't"} available this week. Please remove ${out.length > 1 ? 'them' : 'it'} from your order.`, unavailable: items.filter((i) => unavailable.includes(i.item.id)).map((i) => i.item.id) }, 409);
    }
  }

  const zips = (site.deliveryZips || []).map(String);
  const zip = String(body.zip || '').replace(/\D/g, '').slice(0, 5);
  if (mode === 'delivery' && zips.length && !zips.includes(zip)) {
    return json({ error: zip ? `Sorry, we don't deliver to ${zip} yet. Please choose pickup instead.` : 'Please enter your delivery ZIP code.' }, 400);
  }

  // Customer's comment (optional): plain text, one paragraph, max 250 characters.
  const note = String(body.note || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 250);

  if (!date) return json({ error: 'No upcoming fulfillment date is open right now.' }, 409);
  const when = prettyDate(date);
  const pickupWindow = extraDay ? windowText : site.pickupWindow;
  const deliveryWindow = extraDay ? (windowText ? 'between ' + windowText.replace(/\s*[–-]\s*/, ' and ') : '') : site.deliveryWindow;

  // Item notes show on Square's emailed receipt (when "Show item notes" is on in Square's receipt settings).
  // The first item also tells the customer to expect our follow-up email.
  const followUp = mode === 'pickup'
    ? `Pickup ${when}${pickupWindow ? ', ' + pickupWindow : ''} in ${site.pickupLocation}. Once your order is ready, we'll email you the pickup address and instructions.`
    : `Delivery ${when}${deliveryWindow ? ', ' + deliveryWindow : ''}. We'll email you when your order is on its way. Not home? Leave a cooler outside.`;
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
        ...(note ? { metadata: { customer_note: note } } : {}),
        // Pickup/delivery details so the order shows on Square's Orders screen; the customer's
        // name, email, phone (and address for delivery) are filled in by Square at checkout.
        fulfillments: [mode === 'pickup'
          ? { type: 'PICKUP', state: 'PROPOSED', pickup_details: { schedule_type: 'SCHEDULED', pickup_at: noonNC(date), note: `Pickup in ${site.pickupLocation} on ${when}${note ? ` · Customer note: ${note}` : ''}`.slice(0, 500) } }
          : { type: 'SHIPMENT', state: 'PROPOSED', shipment_details: { shipping_note: `Local delivery on ${when}${note ? ` · Customer note: ${note}` : ''}`.slice(0, 500) } }],
      },
      checkout_options: {
        ask_for_shipping_address: mode === 'delivery',
        redirect_url: `${origin}/order/thanks/`,
        merchant_support_email: site.email,
        allow_tipping: false,
      },
      payment_note: `${mode === 'pickup' ? `PICKUP in ${site.pickupLocation}` : `DELIVERY${zip ? ` (ZIP ${zip})` : ''}`} on ${when}${note ? ` · Note: ${note}` : ''}`.slice(0, 500),
      // No pre_populated_data here: Square rejects it together with an order fulfillment
      // ("Only one of [fulfillment, buyer_…] fields should be set"), which broke every delivery checkout.
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.payment_link?.url) {
    console.log('Square error', res.status, JSON.stringify(data.errors || data));
    // Short Square error code (e.g. UNAUTHORIZED) in the message so a screenshot tells us what went wrong.
    const ref = (data.errors || []).map((e) => e.code).filter(Boolean).slice(0, 2).join(', ') || `HTTP ${res.status}`;
    return json({ error: `Checkout is temporarily unavailable (ref: Square ${ref}).` }, 502);
  }
  return json({ url: data.payment_link.url });
}
