// POST /api/admin/notify  { orderId, kind?, note? }
// Emails the customer that their pickup order is ready or their delivery is on its way
// (kind 'delivered': that the delivery was left at their door),
// then marks the order in Square so the orders page shows it was sent.
// "Delivered" is stored as order metadata delivered_at, not by completing the order,
// so the order stays in the ops sheet's Deliveries tab.
import { square, describeOrder } from '../../_lib/square.js';
import site from '../../../data/site.json';
import { prettyDate } from '../../_lib/fulfillment.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!env.FORM_WEBHOOK_URL) return json({ error: 'Email sending is not connected (FORM_WEBHOOK_URL missing).' }, 503);

  try {
    const { order } = await square(env, `/v2/orders/${encodeURIComponent(body.orderId || '')}`);
    const o = await describeOrder(env, order);
    if (!o) return json({ error: 'That is not a website order.' }, 400);
    if (!o.email) return json({ error: 'This order has no customer email. Call or text them instead.' }, 400);
    const delivered = body.kind === 'delivered';
    if (delivered && o.mode !== 'delivery') return json({ error: 'Only delivery orders can be marked delivered.' }, 400);
    if (o.mode === 'pickup' && !site.pickupAddress) return json({ error: 'Add the pickup address in data/site.json before sending pickup messages.' }, 400);

    const first = (o.name || '').split(' ')[0] || 'there';
    // Use the day the message is sent (orders are sometimes ready Friday or Saturday), in North Carolina time.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const items = o.items.map((i) => `  ${i.qty} × ${i.name}`).join('\n');
    const note = (body.note || '').trim();
    // Times can be changed on the orders page for days other than Sunday; otherwise the defaults from site.json.
    const pickupWindow = String(body.pickupWindow ?? site.pickupWindow ?? '').trim().slice(0, 60);
    const deliveryWindow = String(body.deliveryWindow ?? site.deliveryWindow ?? '').trim().slice(0, 60);
    const subject = delivered ? "Your Hummus Y'all order has been delivered"
      : o.mode === 'pickup' ? "Your Hummus Y'all order is ready for pickup" : "Your Hummus Y'all order is on its way";
    const text = [
      `Hi ${first},`,
      '',
      delivered
        ? `Your order was delivered today (${prettyDate(today)}) and is waiting at your door.${o.address ? `\n\n  ${o.address}` : ''}\n\nPlease put the hummus in the fridge soon.`
        : o.mode === 'pickup'
        ? `Your order is ready! Pick it up today (${prettyDate(today)}) at:\n\n  ${site.pickupAddress}${pickupWindow ? `\n  Pickup time: ${pickupWindow}` : ''}`
        : `Your order is on its way and will arrive today (${prettyDate(today)})${deliveryWindow ? `, ${deliveryWindow}` : ''}.${o.address ? `\n\nDelivering to: ${o.address}` : ''}\nNot home? Leave a cooler outside and we'll take care of the rest.`,
      note ? `\n${note}` : '',
      '',
      'Your order:',
      items,
      '',
      'Storing and serving:',
      '  • Keep the hummus refrigerated.',
      '  • Keep the pita frozen until serving. Warm it in the microwave for 60 seconds and serve immediately.',
      '  • Serving suggestion: warm the hummus in the microwave for 30 seconds before serving.',
      '',
      "Thank you for ordering from Hummus Y'all!",
      `Questions? Just reply to this email or write to ${site.email}.`,
    ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');

    const res = await fetch(env.FORM_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.FORM_SECRET || '', action: 'notify', to: o.email, subject, body: text, replyTo: site.email }),
      redirect: 'follow',
    });
    const sent = await res.json().catch(() => ({}));
    if (!res.ok || !sent.ok) return json({ error: 'The email could not be sent. Check that the Google script is updated and deployed.' }, 502);

    // Record it in Square: mark the pickup/delivery as prepared, and note when it was delivered.
    const update = {};
    if (o.fulfillmentUid && !o.notified) update.fulfillments = [{ uid: o.fulfillmentUid, state: 'PREPARED' }];
    if (delivered && !o.delivered) update.metadata = { delivered_at: new Date().toISOString() };
    if (Object.keys(update).length) {
      try {
        await square(env, `/v2/orders/${o.id}`, {
          method: 'PUT',
          body: { idempotency_key: crypto.randomUUID(), order: { location_id: order.location_id, version: o.version, ...update } },
        });
      } catch { /* email went out; the status just won't update */ }
    }
    return json({ ok: true, to: o.email });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
