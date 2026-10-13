// Farmers market map (Leaflet + OpenStreetMap). Pins come from data/markets.json; this week's markets are highlighted.
(function () {
  var el = document.getElementById('map');
  if (!el || !window.L || !window.HY) return;
  var HY = window.HY;
  var thisWeek = {};
  (HY.schedule.days || []).forEach(function (d) { d.markets.forEach(function (s) { thisWeek[s.id] = s.hours; }); });
  var map = L.map(el, { scrollWheelZoom: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  var bounds = [];
  HY.markets.forEach(function (m) {
    var on = !!thisWeek[m.id];
    var marker = L.circleMarker([m.lat, m.lng], { radius: on ? 11 : 8, color: '#fff', weight: 3, fillColor: on ? m.color : '#9A9A8A', fillOpacity: 1 }).addTo(map);
    var dir = 'https://www.google.com/maps/dir/?api=1&destination=' + m.lat + ',' + m.lng;
    marker.bindPopup('<strong>' + m.name + '</strong><br>' + m.town + '<br>' + (on ? 'This week: ' + thisWeek[m.id] : (HY.schedule.days || []).length ? 'Not this week' : '') + '<br><small>' + m.hours.join('<br>') + '</small><br><a href="' + dir + '" target="_blank" rel="noopener">Directions</a>');
    bounds.push([m.lat, m.lng]);
  });
  map.fitBounds(bounds, { padding: [30, 30] });
})();
