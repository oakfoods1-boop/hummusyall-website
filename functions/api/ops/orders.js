// GET /api/ops/orders  (header X-Ops-Key: <FORM_SECRET>)
// For the market operations Google Sheet: paid website orders for today's or an upcoming fulfillment day,
// with each item mapped to the sheet's column name (data/menu.json "plan"; pita → "Pitas").
// Leaves out customer emails and money (the sheet is shared with contractors).
import { listWebOrders } from '../../_lib/orders.js';
import menu from '../../../data/menu.json';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const same = (a, b) => { // constant-time string compare
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
};
const todayNC = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

// Square line-item name (as the checkout writes it) → sheet column
const columnByName = Object.fromEntries([...menu.bowls, ...menu.extras].map((i) => [
  (i.name + (i.size ? ` (${i.size})` : '')).toLowerCase(),
  i.plan || (i.id === 'pita' ? 'Pitas' : ''),
]));

export async function onRequestGet({ request, env }) {
  if (!env.FORM_SECRET || !same(request.headers.get('X-Ops-Key') || '', env.FORM_SECRET)) return json({ error: 'forbidden' }, 403);
  try {
    const today = todayNC();
    const orders = (await listWebOrders(env, 21))
      .filter((o) => o.date >= today && o.state !== 'COMPLETED')
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
      .map((o) => ({
        number: 'W-' + o.id.slice(-6).toUpperCase(),
        createdAt: o.createdAt,
        date: o.date,
        mode: o.mode,
        name: o.name,
        phone: o.phone,
        address: o.address,
        notified: o.notified,
        note: o.note || '',
        items: o.items.map((i) => ({ name: i.name, qty: i.qty, col: columnByName[(i.name || '').toLowerCase()] || '' })),
      }));
    return json({ ok: true, today, orders });
  } catch (e) {
    return json({ ok: false, error: e.message }, 502);
  }
}
