// Private orders page: lists paid website orders and sends "ready" / "on its way" / "delivered" emails.
(function () {
  'use strict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var listEl = $('[data-orders]'), dayEl = $('[data-day]'), errEl = $('[data-admin-error]'), statsEl = $('[data-stats]');
  var all = [], settings = {};

  function prettyDay(iso) { return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); }
  function telHref(p) { return 'tel:' + String(p).replace(/[^\d+]/g, ''); }
  function prettyPhone(p) { var d = String(p).replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : String(p); }

  function load() {
    errEl.hidden = true;
    listEl.innerHTML = '<p class="muted">Loading orders…</p>';
    fetch('/api/admin/orders', { cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not load orders.'); return j; }); })
      .then(function (j) {
        all = j.orders || []; settings = j.settings || {};
        var pw = $('[data-pickup-window]'), dw = $('[data-delivery-window]');
        if (!pw.value) pw.value = settings.pickupWindow || '';
        if (!dw.value) dw.value = settings.deliveryWindow || '';
        var days = Array.from(new Set(all.map(function (o) { return o.date; }))).sort().reverse();
        var keep = dayEl.value;
        dayEl.innerHTML = days.length ? days.map(function (d) { return '<option value="' + d + '">' + prettyDay(d) + '</option>'; }).join('') : '<option value="">No orders yet</option>';
        if (keep && days.indexOf(keep) !== -1) dayEl.value = keep;
        var warn = $('[data-settings-warning]');
        warn.hidden = !!settings.pickupAddress;
        warn.textContent = 'The pickup address is not set yet, so "Ready for pickup" emails are turned off. Send Claude the pickup address and time window.';
        render();
      })
      .catch(function (e) { errEl.textContent = e.message; errEl.hidden = false; listEl.innerHTML = ''; });
  }

  function render() {
    var day = dayEl.value;
    var list = all.filter(function (o) { return o.date === day; }).sort(function (a, b) { return a.mode === b.mode ? (a.name || '').localeCompare(b.name || '') : a.mode === 'pickup' ? -1 : 1; });
    var count = function (m) { return list.filter(function (o) { return !m || o.mode === m; }).length; };
    var bowls = {};
    list.forEach(function (o) { o.items.forEach(function (i) { bowls[i.name] = (bowls[i.name] || 0) + i.qty; }); });
    statsEl.innerHTML = list.length
      ? '<div class="note"><strong>' + count() + ' orders</strong> · ' + count('pickup') + ' pickup · ' + count('delivery') + ' delivery · ' + list.filter(function (o) { return o.notified; }).length + ' notified' +
        (count('delivery') ? ' · ' + list.filter(function (o) { return o.delivered; }).length + ' delivered' : '') + '</div>' +
        '<div class="note"><strong>To prepare:</strong> ' + Object.keys(bowls).sort().map(function (k) { return bowls[k] + ' × ' + esc(k); }).join(' · ') + '</div>'
      : '';
    if (!list.length) { listEl.innerHTML = '<p class="muted">No paid website orders for this day.</p>'; return; }
    listEl.innerHTML = list.map(function (o) {
      var isPickup = o.mode === 'pickup';
      var canSend = o.email && (!isPickup || settings.pickupAddress);
      var done = isPickup ? o.notified : o.delivered;
      return '<article class="card admin-order' + (done ? ' done' : '') + '">' +
        '<div class="admin-top"><div><h3>' + esc(o.name || 'Customer') + '</h3>' +
        '<span class="pill ' + (isPickup ? '' : 'pill-new') + '">' + (isPickup ? 'Pickup' : 'Delivery') + '</span>' +
        (o.delivered ? ' <span class="pill pill-done">Delivered ✓</span>' : o.notified ? ' <span class="pill pill-done">Notified ✓</span>' : '') +
        (o.outsideArea ? ' <span class="pill pill-warn">Outside delivery area (' + esc(o.zip) + ')</span>' : '') + '</div>' +
        '<span class="price">$' + o.total.toFixed(2) + '</span></div>' +
        '<ul class="admin-items">' + o.items.map(function (i) { return '<li>' + i.qty + ' × ' + esc(i.name) + '</li>'; }).join('') + '</ul>' +
        (o.note ? '<p class="admin-note"><strong>Customer note:</strong> ' + esc(o.note) + '</p>' : '') +
        (o.address ? '<p><a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address) + '" target="_blank" rel="noopener">' + esc(o.address) + '</a></p>' : '') +
        '<p class="admin-contact">' + (o.phone ? '<a href="' + telHref(o.phone) + '">' + esc(prettyPhone(o.phone)) + '</a>' : '<span class="muted">No phone</span>') + ' · ' +
        (o.email ? esc(o.email) : '<span class="muted">No email</span>') + '</p>' +
        '<div class="btn-row"><button class="btn ' + (o.notified ? 'btn-outline' : 'btn-primary') + '" type="button" data-send="' + esc(o.id) + '"' + (canSend ? '' : ' disabled') + '>' +
        (o.notified ? (isPickup ? 'Send again' : 'On its way again') : isPickup ? 'Ready for pickup' : 'On its way') + '</button>' +
        (isPickup ? '' : '<button class="btn ' + (o.notified && !o.delivered ? 'btn-primary' : 'btn-outline') + '" type="button" data-send="' + esc(o.id) + '" data-kind="delivered"' + (o.email ? '' : ' disabled') + '>' +
          (o.delivered ? 'Delivered again' : 'Delivered') + '</button>') + '</div>' +
        '<p class="form-status" data-status="' + esc(o.id) + '" hidden></p></article>';
    }).join('');
  }

  dayEl.addEventListener('change', render);
  $('[data-refresh]').addEventListener('click', load);
  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-send]');
    if (!btn) return;
    var id = btn.getAttribute('data-send');
    var kind = btn.getAttribute('data-kind') || '';
    var label = btn.textContent;
    var o = all.filter(function (x) { return x.id === id; })[0];
    var st = $('[data-status="' + id + '"]');
    var already = kind === 'delivered' ? o.delivered : o.notified;
    if (already && st.getAttribute('data-confirm') !== kind + '1') {
      st.className = 'form-status err'; st.hidden = false; st.setAttribute('data-confirm', kind + '1');
      st.textContent = (kind === 'delivered' ? 'Already marked delivered. Tap "Delivered again"' : 'Already notified. Tap "' + label + '"') + ' once more to send another email.';
      return;
    }
    btn.disabled = true; btn.textContent = 'Sending…';
    fetch('/api/admin/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: id, kind: kind, note: $('[data-note]').value, pickupWindow: $('[data-pickup-window]').value, deliveryWindow: $('[data-delivery-window]').value }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not send.'); return j; }); })
      .then(function (j) {
        o.notified = true; if (kind === 'delivered') o.delivered = true; render();
        var s = $('[data-status="' + id + '"]'); s.className = 'form-status ok'; s.textContent = 'Email sent to ' + j.to + '.'; s.hidden = false;
      })
      .catch(function (err) { st.className = 'form-status err'; st.textContent = err.message; st.hidden = false; btn.disabled = false; btn.textContent = label; });
  });
  load();
})();
