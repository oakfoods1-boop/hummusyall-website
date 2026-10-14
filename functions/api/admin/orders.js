// GET /api/admin/orders  →  paid website orders from the last 3 weeks, newest first, grouped by fulfillment date.
import { listWebOrders } from '../../_lib/orders.js';
import site from '../../../data/site.json';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestGet({ env }) {
  try {
    const zips = (site.deliveryZips || []).map(String);
    const list = (await listWebOrders(env, 21))
      .map((o) => ({ ...o, outsideArea: o.mode === 'delivery' && zips.length > 0 && !!o.zip && !zips.includes(o.zip) }));
    return json({
      orders: list,
      settings: { pickupAddress: site.pickupAddress || '', pickupWindow: site.pickupWindow || '', deliveryWindow: site.deliveryWindow || '' },
    });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
