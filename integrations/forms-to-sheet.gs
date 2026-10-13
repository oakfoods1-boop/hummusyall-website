/**
 * Hummus Y'all website forms -> Google Sheet + email
 *
 * Setup (one time, about 5 minutes):
 * 1. Create a Google Sheet named "Website Inquiries". Extensions > Apps Script. Paste this file.
 * 2. Set SECRET below to the same text as FORM_SECRET in Cloudflare.
 * 3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * 4. Copy the web app URL into Cloudflare as FORM_WEBHOOK_URL.
 * Each form gets its own tab ("Catering inquiry", "Job application") and every submission emails NOTIFY.
 *
 * Also answers the website's "what's available this week" question by reading the TOTAL row of the
 * Plan tab in the market operations sheet (OPS_SHEET_ID). Read-only: it never changes that sheet.
 */
var SECRET = 'CHANGE-ME';
var NOTIFY = 'alon@hummusyall.com';
var OPS_SHEET_ID = '1vZIVS0CRQHKjcXy4MOi1XUcaEG5HItekq6CbuNosDfQ';

function doPost(e) {
  var body = JSON.parse(e.postData.contents || '{}');
  if (body.secret !== SECRET) return out({ ok: false, error: 'forbidden' });

  // Customer messages from the private orders page ("ready for pickup", "on its way").
  if (body.action === 'notify') {
    MailApp.sendEmail({ to: body.to, subject: body.subject, body: body.body, name: "Hummus Y'all", replyTo: body.replyTo || NOTIFY });
    return out({ ok: true });
  }

  // What's being made this week: Plan tab TOTAL row, by column header.
  if (body.action === 'availability') return out(planTotals());

  var s = body.submission || {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(s.formTitle) || ss.insertSheet(s.formTitle);
  var keys = Object.keys(s).filter(function (k) { return k !== 'form' && k !== 'formTitle'; });
  var headers = tab.getLastRow() ? tab.getRange(1, 1, 1, tab.getLastColumn()).getValues()[0] : [];
  keys.forEach(function (k) { if (headers.indexOf(k) === -1) headers.push(k); });
  tab.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  tab.appendRow(headers.map(function (h) { return s[h] || ''; }));

  var lines = keys.map(function (k) { return k + ': ' + s[k]; }).join('\n');
  MailApp.sendEmail({
    to: NOTIFY,
    replyTo: s.email,
    subject: s.formTitle + ' from ' + (s.firstName || '') + ' ' + (s.lastName || ''),
    body: lines + '\n\nAll submissions: ' + ss.getUrl(),
  });
  return out({ ok: true });
}

// Plan tab: TOTAL row by column header (what's being made), and the markets with bowls planned + their dates.
function planTotals() {
  var plan = SpreadsheetApp.openById(OPS_SHEET_ID).getSheetByName('Plan');
  var tz = plan.getParent().getSpreadsheetTimeZone();
  var vals = plan.getRange(1, 1, Math.min(plan.getLastRow(), 80), plan.getLastColumn()).getValues();
  var head = -1, total = -1;
  for (var i = 0; i < vals.length; i++) {
    var a = String(vals[i][0]).trim().toLowerCase();
    if (head < 0 && a === 'market') head = i;
    else if (head >= 0 && a === 'total') { total = i; break; }
  }
  if (head < 0 || total < 0) return { ok: false, error: 'Plan header or TOTAL row not found' };
  var totals = {}, colTotal = -1, colDate = -1;
  vals[head].forEach(function (h, c) {
    h = String(h).trim();
    if (h && c > 0) totals[h] = Number(vals[total][c]) || 0;
    if (/^total bowls$/i.test(h)) colTotal = c;
    if (/^date if not/i.test(h)) colDate = c;
  });
  var main = ymd(plan.getRange('B4').getValue(), tz);
  var markets = [];
  for (var r = head + 1; r < total; r++) {
    var name = String(vals[r][0]).trim();
    if (!name || /^pick\s*-?up/i.test(name) || /^misc$/i.test(name)) continue;
    if (colTotal >= 0 && !(Number(vals[r][colTotal]) > 0)) continue;
    markets.push({ name: name, date: (colDate >= 0 && ymd(vals[r][colDate], tz)) || main });
  }
  return { ok: true, date: main, totals: totals, markets: markets };
}

// A sheet date (or date-like text such as 10/17/2026) as 'yyyy-MM-dd', or '' if it isn't one.
function ymd(v, tz) {
  if (v && typeof v.getTime === 'function' && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : '';
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
