// GET /api/admin/orders  →  paid website orders from the last 3 weeks, newest first, grouped by fulfillment date.
import { square, describeOrder } from '../../_lib/square.js';
import site from '../../../data/site.json';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestGet({ env }) {
  try {
    const since = new Date(Date.now() - 21 * 864e5).toISOString();
    const orders = [];
    let cursor;
    do {
      const data = await square(env, '/v2/orders/search', {
        method: 'POST',
        body: {
          location_ids: [env.SQUARE_LOCATION_ID],
          cursor,
          limit: 200,
          query: {
            filter: { state_filter: { states: ['OPEN', 'COMPLETED'] }, date_time_filter: { created_at: { start_at: since } } },
            sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
          },
        },
      });
      orders.push(...(data.orders || []));
      cursor = data.cursor;
    } while (cursor && orders.length < 1000);

    const paid = orders.filter((o) => (o.reference_id || '').startsWith('web-') && (o.tenders || []).length && !(o.refunds || []).length);
    const zips = (site.deliveryZips || []).map(String);
    const list = (await Promise.all(paid.map((o) => describeOrder(env, o)))).filter(Boolean)
      .map((o) => ({ ...o, outsideArea: o.mode === 'delivery' && zips.length > 0 && !!o.zip && !zips.includes(o.zip) }));
    return json({
      orders: list,
      settings: { pickupAddress: site.pickupAddress || '', pickupWindow: site.pickupWindow || '', deliveryWindow: site.deliveryWindow || '' },
    });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
