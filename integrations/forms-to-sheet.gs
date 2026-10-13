/**
 * Hummus Y'all website forms -> Google Sheet + email
 *
 * Setup (one time, about 5 minutes):
 * 1. Create a Google Sheet named "Website Inquiries". Extensions > Apps Script. Paste this file.
 * 2. Set SECRET below to the same text as FORM_SECRET in Cloudflare.
 * 3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * 4. Copy the web app URL into Cloudflare as FORM_WEBHOOK_URL.
 * Each form gets its own tab ("Catering inquiry", "Job application") and every submission emails NOTIFY.
 */
var SECRET = 'CHANGE-ME';
var NOTIFY = 'alon@hummusyall.com';

function doPost(e) {
  var body = JSON.parse(e.postData.contents || '{}');
  if (body.secret !== SECRET) return out({ ok: false, error: 'forbidden' });
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

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
