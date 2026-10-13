// Hummus Y'all — shared site behavior. Data comes from window.HY (written at build time from data/*.json).
(function () {
  'use strict';
  var HY = window.HY || {};
  var BASE = window.HY_BASE || '/';
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  // ---------- Mobile menu + header ----------
  var toggle = $('[data-nav-toggle]');
  var nav = $('#site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    $$('a', nav).forEach(function (a) { a.addEventListener('click', function () { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }); });
  }
  var header = $('[data-header]');
  if (header) {
    var onScroll = function () { header.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }

  // Homepage video: show the still picture instead for visitors who prefer less motion.
  var heroVideo = $('[data-hero-video]');
  if (heroVideo && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { heroVideo.removeAttribute('autoplay'); heroVideo.pause(); }

  // ---------- Next fulfillment date (always current, never stale) ----------
  // Works in North Carolina time no matter where the visitor is.
  function nowInNC() {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    var p = {}; parts.forEach(function (x) { p[x.type] = x.value; });
    return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function nextFulfillment() {
    var s = HY.site || {};
    var wd = s.fulfillmentWeekday != null ? s.fulfillmentWeekday : 0;
    var cut = s.orderCutoff || { weekday: 6, hour: 23, minute: 59 };
    var skip = s.skipDates || [];
    var now = nowInNC();
    for (var i = 0; i < 35; i++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      if (d.getDay() !== wd || skip.indexOf(iso(d)) !== -1) continue;
      var back = (wd - cut.weekday + 7) % 7;
      var cutoff = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, cut.hour, cut.minute, 59);
      if (now <= cutoff) return d;
    }
    return null;
  }
  var next = nextFulfillment();
  HY.nextDate = next ? iso(next) : null;
  if (next) {
    var long = next.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    var day = next.toLocaleDateString('en-US', { weekday: 'long' });
    $$('[data-next-date]').forEach(function (el) { el.textContent = long; });
    $$('[data-next-day]').forEach(function (el) { el.textContent = day; });
    // Order cutoff for that Sunday (e.g. "Thursday, Oct 15")
    var cs = (HY.site || {}).orderCutoff || { weekday: 4 };
    var cutDay = new Date(next.getFullYear(), next.getMonth(), next.getDate() - (next.getDay() - cs.weekday + 7) % 7);
    var cutLabel = cutDay.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    $$('[data-cutoff]').forEach(function (el) { el.textContent = cutLabel; });
  }
  if (HY.site && HY.site.ordersOpen === false) {
    var bar = $('[data-announce]');
    if (bar) bar.innerHTML = '<strong>' + escapeHtml(HY.site.ordersClosedMessage) + '</strong>';
  }

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { return '$' + (Number.isInteger(n) ? n : n.toFixed(2)); }

  // ---------- This week's menu (items not being made show "Not available this week") ----------
  function markUnavailable(ids) {
    ids.forEach(function (id) {
      var el = $('[data-item="' + id + '"]');
      if (!el || el.classList.contains('is-out')) return;
      el.classList.add('is-out');
      var label = document.createElement('span');
      label.className = 'out-label';
      label.textContent = 'Not available this week';
      var ctl = $('.qty', el) || $('a.btn', el);
      if (ctl) ctl.replaceWith(label); else el.appendChild(label);
    });
  }
  function loadAvailability(cb) {
    fetch(BASE.charAt(0) === '/' ? '/api/availability' : 'api/availability', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { unavailable: [] }; })
      .then(function (j) { var ids = j.unavailable || []; markUnavailable(ids); if (cb) cb(ids); })
      .catch(function () {});
  }
  if ($('[data-item]') && !$('[data-bowls]')) loadAvailability();

  // ---------- Order page ----------
  var bowlsEl = $('[data-bowls]');
  if (bowlsEl && HY.menu) {
    var CART_KEY = 'hy-cart-v1';
    var state = { qty: {}, mode: null };
    try { var saved = JSON.parse(localStorage.getItem(CART_KEY) || 'null'); if (saved && saved.qty) state.qty = saved.qty; } catch (e) {}
    // Delivery vs pickup is always an active choice on each visit (nothing pre-selected).
    var save = function () { try { localStorage.setItem(CART_KEY, JSON.stringify(state)); } catch (e) {} };
    var all = HY.menu.bowls.concat(HY.menu.extras);
    var byId = {}; all.forEach(function (i) { byId[i.id] = i; });

    var qtyControls = function (item) {
      return '<div class="qty"><button type="button" data-dec="' + item.id + '" aria-label="Remove one ' + escapeHtml(item.name) + '">−</button>' +
        '<output aria-live="polite" data-q="' + item.id + '">0</output>' +
        '<button type="button" class="plus" data-inc="' + item.id + '" aria-label="Add one ' + escapeHtml(item.name) + '">+</button></div>';
    };
    bowlsEl.innerHTML = HY.menu.bowls.map(function (b) {
      return '<article class="card" id="' + b.id + '" data-item="' + b.id + '">' +
        '<img src="' + BASE + 'img/' + b.image + '.webp" alt="' + escapeHtml(b.name) + '" class="card-img" width="700" height="525" loading="lazy">' +
        '<div class="card-title"><h3>' + escapeHtml(b.name) + '</h3><span class="price">' + money(b.price) + '</span></div>' +
        '<p>' + escapeHtml(b.description) + '</p>' + qtyControls(b) + '</article>';
    }).join('');
    $('[data-extras]').innerHTML = HY.menu.extras.map(function (x) {
      return '<div class="extra-row" id="' + x.id + '" data-item="' + x.id + '">' + (x.image ? '<img src="' + BASE + 'img/' + x.image + '.webp" alt="" width="64" height="64" loading="lazy">' : '') +
        '<div class="info"><strong>' + escapeHtml(x.name) + '</strong><span>' + escapeHtml([x.subtitle, (x.size || '').replace(' ', '\u00a0')].filter(Boolean).join(' · ')) + '</span></div>' +
        '<span class="price">' + money(x.price) + '</span>' + qtyControls(x) + '</div>';
    }).join('');

    var modeNote = $('[data-mode-note]');
    var zipField = $('[data-zip-field]'), zipInput = $('[data-zip]'), zipMsg = $('[data-zip-msg]');
    var zips = (HY.site.deliveryZips || []).map(String);
    if (state.zip) zipInput.value = state.zip;
    // 'ok' when delivery can go ahead, 'incomplete' while the ZIP isn't 5 digits yet, 'no' when we don't deliver there.
    var zipStatus = function () {
      if (state.mode !== 'delivery' || !zips.length) return 'ok';
      var z = state.zip || '';
      if (z.length < 5) return 'incomplete';
      return zips.indexOf(z) !== -1 ? 'ok' : 'no';
    };
    var fulfil = $('[data-fulfil]');
    var nextLong = next ? next.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : 'Sunday';
    var render = function () {
      var lines = [], sub = 0, count = 0;
      all.forEach(function (i) {
        var q = state.qty[i.id] || 0;
        var out = $('[data-q="' + i.id + '"]'); if (out) out.textContent = q;
        if (q > 0) { lines.push('<div><span>' + q + ' × ' + escapeHtml(i.name) + '</span><span>' + money(q * i.price) + '</span></div>'); sub += q * i.price; count += q; }
      });
      $('[data-lines]').innerHTML = lines.join('');
      $('[data-empty]').hidden = count > 0;
      var fee = state.mode === 'delivery' && count > 0 ? (HY.site.deliveryFee || 0) : 0;
      var rate = HY.site.taxRate || 0;
      var taxCents = Math.round((sub + fee) * rate);          // dollars × percent = cents
      var total = sub + fee + taxCents / 100;
      $('[data-subtotal]').textContent = money(sub);
      $('[data-fee-row]').hidden = !fee;
      $('[data-fee]').textContent = money(fee);
      $('[data-tax-label]').textContent = 'Sales tax (' + rate + '%)';
      $('[data-tax]').textContent = '$' + (taxCents / 100).toFixed(2);
      $('[data-total]').textContent = '$' + total.toFixed(2);
      $('[data-total-note]').textContent = state.mode === 'delivery' ? 'Delivery on ' + nextLong
        : state.mode === 'pickup' ? 'Pickup in ' + HY.site.pickupLocation + ' on ' + nextLong : '';
      var closed = HY.site.ordersOpen === false || !next;
      var btn = $('[data-checkout]');
      var zs = zipStatus();
      btn.disabled = count === 0 || closed || zs === 'no';
      btn.textContent = count > 0 && !state.mode ? 'Choose delivery or pickup'
        : count > 0 && zs === 'incomplete' ? 'Enter your delivery ZIP code'
        : count > 0 && zs === 'no' ? 'Delivery not available for this ZIP' : 'Checkout securely';
      zipField.hidden = state.mode !== 'delivery' || !zips.length;
      zipMsg.className = 'zip-msg' + (zs === 'ok' && state.zip ? ' ok' : zs === 'no' ? ' no' : '');
      zipMsg.textContent = zs === 'no' ? 'Sorry, we don\'t deliver to ' + state.zip + ' yet. Choose free pickup in ' + HY.site.pickupLocation.replace(/, NC$/, '') + ' instead.'
        : zs === 'ok' && state.zip ? '✓ We deliver to ' + state.zip + '.' : '';
      fulfil.classList.toggle('needs-choice', count > 0 && !state.mode);
      $$('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === state.mode)); });
      modeNote.hidden = !state.mode;
      modeNote.textContent = state.mode === 'delivery'
        ? 'We deliver on ' + nextLong + (HY.site.deliveryWindow ? ', ' + HY.site.deliveryWindow : '') + '. Not home? Leave a cooler outside. You\'ll enter your address at checkout.'
        : state.mode === 'pickup' ? 'Pick up in ' + HY.site.pickupLocation + ' on ' + nextLong + (HY.site.pickupWindow ? ', ' + HY.site.pickupWindow : '') + '. We\'ll email you the address as soon as your order is ready.' : '';
      var bar = $('[data-mobile-bar]');
      if (bar) { bar.hidden = count === 0; document.body.classList.toggle('has-bar', count > 0); $('[data-bar-count]').textContent = count + (count === 1 ? ' item' : ' items'); $('[data-bar-total]').textContent = '$' + total.toFixed(2); }
      save();
    };
    var closedEl = $('[data-orders-closed]');
    if (closedEl && (HY.site.ordersOpen === false || !next)) { closedEl.hidden = false; closedEl.textContent = HY.site.ordersClosedMessage; }

    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-inc],[data-dec],[data-mode]');
      if (!t) return;
      if (t.hasAttribute('data-mode')) state.mode = t.getAttribute('data-mode');
      else {
        var id = t.getAttribute('data-inc') || t.getAttribute('data-dec');
        var q = (state.qty[id] || 0) + (t.hasAttribute('data-inc') ? 1 : -1);
        state.qty[id] = Math.max(0, Math.min(50, q));
      }
      render();
    });

    // Arriving from "Add to order" on the homepage (/order/#sabich): add one and scroll to it.
    if (location.hash && byId[location.hash.slice(1)]) {
      var hid = location.hash.slice(1);
      if (!state.qty[hid]) state.qty[hid] = 1;
      history.replaceState(null, '', location.pathname);
    }
    zipInput.addEventListener('input', function () {
      var v = zipInput.value.replace(/\D/g, '').slice(0, 5);
      if (zipInput.value !== v) zipInput.value = v;
      state.zip = v; render();
    });
    render();

    var checkout = $('[data-checkout]');
    var errEl = $('[data-checkout-error]');
    var dropUnavailable = function (ids) {
      markUnavailable(ids);
      var removed = ids.filter(function (id) { return state.qty[id] > 0; });
      removed.forEach(function (id) { state.qty[id] = 0; });
      if (removed.length) {
        errEl.textContent = 'We took ' + removed.map(function (id) { return byId[id].name; }).join(' and ') +
          ' out of your order. ' + (removed.length > 1 ? 'They aren\'t' : 'It isn\'t') + ' available this week.';
        errEl.hidden = false;
      }
      render();
    };
    loadAvailability(dropUnavailable);
    checkout.addEventListener('click', function () {
      errEl.hidden = true;
      if (!state.mode) {
        fulfil.classList.add('needs-choice');
        fulfil.scrollIntoView({ behavior: 'smooth', block: 'center' });
        $('.fulfil-opt', fulfil).focus({ preventScroll: true });
        return;
      }
      if (zipStatus() === 'incomplete') { zipInput.focus(); zipField.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      checkout.disabled = true; checkout.textContent = 'Opening secure checkout…';
      var items = Object.keys(state.qty).filter(function (k) { return state.qty[k] > 0 && byId[k]; }).map(function (k) { return { id: k, qty: state.qty[k] }; });
      fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items, mode: state.mode, zip: state.mode === 'delivery' ? state.zip || '' : '' }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (res.j && res.j.unavailable) { markUnavailable(res.j.unavailable); res.j.unavailable.forEach(function (id) { state.qty[id] = 0; }); }
          if (!res.ok || !res.j.url) throw new Error(res.j && res.j.error || 'Checkout is not available right now.');
          window.location.href = res.j.url;
        })
        .catch(function (e) {
          errEl.textContent = (e && e.message && e.message.indexOf('Failed to fetch') === -1 ? e.message : 'We couldn\'t reach checkout.') + ' Please try again, or email ' + 'alon@hummusyall.com' + '.';
          errEl.hidden = false; checkout.textContent = 'Checkout securely'; render();
        });
    });
  }

  // ---------- Forms (catering inquiry, job applications) ----------
  $$('form[data-form]').forEach(function (form) {
    var status = $('.form-status', form);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var firstBad = $$('[required]', form).filter(function (f) { return !f.value.trim() || (f.type === 'email' && !/^\S+@\S+\.\S+$/.test(f.value)); })[0];
      $$('[aria-invalid]', form).forEach(function (f) { f.removeAttribute('aria-invalid'); });
      if (firstBad) {
        firstBad.setAttribute('aria-invalid', 'true'); firstBad.focus();
        status.className = 'form-status err'; status.textContent = 'Please fill in the required fields marked with *.'; status.hidden = false; return;
      }
      var data = { form: form.getAttribute('data-form') };
      new FormData(form).forEach(function (v, k) { data[k] = data[k] ? [].concat(data[k], v) : v; });
      var btn = $('button[type="submit"]', form); var label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Sending…';
      fetch('/api/form', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { if (!r.ok) throw new Error(); form.reset(); status.className = 'form-status ok'; status.textContent = 'Thank you! We got your message and will be in touch soon.'; })
        .catch(function () { status.className = 'form-status err'; status.innerHTML = 'Sorry, that didn\'t go through. Please email us at <a href="mailto:alon@hummusyall.com">alon@hummusyall.com</a>.'; })
        .finally(function () { status.hidden = false; btn.disabled = false; btn.textContent = label; });
    });
  });
})();
