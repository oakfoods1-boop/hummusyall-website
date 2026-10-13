// Small helpers for talking to Square from the server functions.
export function squareBase(env) {
  return env.SQUARE_API_BASE || (env.SQUARE_ENV === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com');
}

export async function square(env, path, { method = 'GET', body } = {}) {
  const res = await fetch(squareBase(env) + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2025-01-23',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.errors || []).map((e) => e.detail || e.code).join('; ') || `Square error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// Turn a Square order (from our website) into the simple shape the orders page and emails use.
export async function describeOrder(env, o) {
  const m = /^web-(\d{4}-\d{2}-\d{2})-(pickup|delivery)$/.exec(o.reference_id || '');
  if (!m) return null;
  const f = (o.fulfillments || [])[0] || {};
  const details = f.pickup_details || f.shipment_details || {};
  const r = details.recipient || {};
  let email = r.email_address || '';
  let phone = r.phone_number || '';
  let name = r.display_name || '';
  let address = r.address || null;
  const paymentId = (o.tenders || [])[0]?.payment_id;
  if (paymentId && (!email || (m[2] === 'delivery' && !address))) {
    try {
      const { payment } = await square(env, `/v2/payments/${paymentId}`);
      email = email || payment.buyer_email_address || '';
      address = address || payment.shipping_address || null;
      name = name || [payment.shipping_address?.first_name, payment.shipping_address?.last_name].filter(Boolean).join(' ');
    } catch { /* keep what we have */ }
  }
  const items = (o.line_items || []).map((li) => ({ name: li.name, qty: Number(li.quantity) }));
  return {
    id: o.id,
    version: o.version,
    fulfillmentUid: f.uid || null,
    date: m[1],
    mode: m[2],
    state: o.state,
    notified: ['PREPARED', 'COMPLETED'].includes(f.state),
    createdAt: o.created_at,
    total: (o.total_money?.amount || 0) / 100,
    name, email, phone,
    address: address ? [address.address_line_1, address.address_line_2, [address.locality, address.administrative_district_level_1].filter(Boolean).join(', '), address.postal_code].filter(Boolean).join(', ') : '',
    items: items.filter((i) => i.name !== 'Delivery'),
  };
}
