// Paid website orders from Square (last `days` days), in the simple shape from describeOrder.
import { square, describeOrder } from './square.js';

export async function listWebOrders(env, days = 21) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
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
  return (await Promise.all(paid.map((o) => describeOrder(env, o)))).filter(Boolean);
}
