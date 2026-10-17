/**
 * Hummus Y'all — market operations sheet + after-market report form
 * Version 7 (10/17/2026): a website delivery marked "Delivered" on the orders page gets its Done box
 * ticked automatically on the next sync (manual Done ticks are still kept).
 * Version 6 (10/14/2026): website orders (hummusyall.com) flow into the Pickups / Deliveries tabs
 * automatically every 15 minutes (and from the menu: "Sync website orders now"). Squarespace CSV
 * rows and website rows live side by side; Done ticks are kept.
 * Version 5 (10/12/2026): each Plan row can have its own date (Plan column Q; blank = the date in B4),
 * so a Sunday pop-up can be planned together with Saturday's markets.
 * Version 4 (10/10/2026): report dates no longer shift a day when the sheet's time zone
 * differs from the script's; "Update this week" also re-creates the form-submit trigger if missing.
 *
 * Paste into Extensions → Apps Script of the Market Operations Google Sheet
 * (replace everything that's there), save, reload the sheet, then use the
 * "Hummus Y'all" menu.
 *
 * How markets work now
 *  - Lists tab, column C = every market you might ever do; column D = its tab name
 *    (optional — blank means the tab uses the market name).
 *  - Plan tab has up to 15 market rows. Pick the market in column A from the drop-down.
 *    A market is RUNNING this week when it has bowls planned (Total bowls > 0).
 *  - "Update this week" then: shows a tab for each running market (and creates a tab for a
 *    new market), hides the tabs of markets that aren't running, puts only the running
 *    markets in the form, and writes each running market's report link.
 */

var BOWLS = ['Sabich', 'Caramelized Onions', 'Chickpeas', 'Cauliflower', 'Mushrooms', 'Green Schug'];
var SIDES = ['Schug side', 'Garlic aioli', 'Baba ganoush'];

// Where things live in the sheet
var MAX_MARKETS = 15;
var PLAN = { sheet: 'Plan', dateCell: 'B4', firstRow: 9, marketCol: 1, operatorCol: 2, totalCol: 10, linkCol: 16, dateCol: 17 };
PLAN.lastRow = PLAN.firstRow + MAX_MARKETS - 1;                 // 23
var RESULTS = { sheet: 'Results', firstRow: 5 };
RESULTS.lastRow = RESULTS.firstRow + MAX_MARKETS - 1;           // 19
var LISTS = { sheet: 'Lists', operators: 'A2:A16', markets: 'C2:D31', editLinkCell: 'G5', formLinkCell: 'G6' };
var RESP_SHEET = 'Responses';
var FIXED_TABS = ['Start Here', 'Plan', 'Results', 'Lists', 'Responses', 'Pickups', 'Deliveries'];

// Online pre-orders (Squarespace orders CSV → Pickups / Deliveries tabs)
var ORDERS = {
  pickupTab: 'Pickups', deliveryTab: 'Deliveries',
  firstRow: 5, maxRows: 300,          // data rows 5–304
  // Squarespace product name (lowercased) → column. First match wins, so bowls come before sides.
  products: [
    { re: /sabich/, col: 'Sabich' },
    { re: /caramelized onion/, col: 'Caramelized Onions' },
    { re: /chickpea/, col: 'Chickpeas' },
    { re: /cauliflower/, col: 'Cauliflower' },
    { re: /mushroom/, col: 'Mushrooms' },
    { re: /^hummus with (green )?schug/, col: 'Green Schug' },
    { re: /green stuff/, col: 'Schug side' },
    { re: /baba/, col: 'Baba ganoush' },
    { re: /aioli/, col: 'Garlic aioli' },
    { re: /schug/, col: 'Schug side' },
    { re: /pita/, col: 'Pitas' }
  ]
};
// Same columns on both tabs; only F differs (Pickup at / Address)
var ORDER_ITEMS = BOWLS.concat(['Total bowls']).concat(SIDES).concat(['Pitas']);   // G..Q
var ORDER_ITEM_COL = 7;                                                             // G

// Website orders (new site on Cloudflare). The key is the website's FORM_SECRET.
var WEB = {
  url: 'https://hummusyall-website.pages.dev/api/ops/orders',
  key: 'PASTE-KEY',
  prefix: 'W-',                 // website order numbers look like W-3F9A2C
  pickupPlace: 'Cary',
  everyMinutes: 15
};
function isWebNumber_(n) { return String(n).replace(/^'/, '').indexOf(WEB.prefix) === 0; }
var OLIVE = '#3E5A2E';

// Form question titles (also used to read answers back)
var Q = {
  date: 'Market date',
  market: 'Market',
  operator: 'Operator',
  donated: 'Bowls donated / given free / used for samples',
  tokenBowls: 'Bowls sold for SNAP tokens',
  tokens: 'SNAP tokens collected ($1 each)',
  fee: 'Stall fee paid in cash ($)',
  endCash: 'Ending cash in the cash box ($)',
  comments: 'Comments'
};
function retTitle(item) { return 'Returned unsold: ' + item; }

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu("Hummus Y'all");
  if (PropertiesService.getDocumentProperties().getProperty('LAYOUT') !== '2') {
    menu.addItem('Upgrade to flexible markets (one time)', 'upgradeToFlexibleMarkets').addSeparator();
  }
  menu.addItem('Update this week (tabs, form, report links)', 'updateWeek')
      .addItem('Add a new market…', 'addMarket')
      .addItem('Sync website orders now', 'syncWebOrdersMenu')
      .addItem('Import pending orders (Squarespace CSV)…', 'showImportOrders')
      .addSeparator()
      .addItem('Re-import all form responses', 'reimportAll')
      .addItem('Set up the after-market form (first time only)', 'setupForm')
      .addToUi();
}

// ======================================================================
// Weekly
// ======================================================================
function updateWeek() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  if (PropertiesService.getDocumentProperties().getProperty('LAYOUT') !== '2') {
    ui.alert('Run "Upgrade to flexible markets (one time)" from the Hummus Y\'all menu first.');
    return;
  }
  ensureRowDates_();
  applyPlanDropdowns_();
  var form = getForm_();
  var tz = ss.getSpreadsheetTimeZone();

  var operators = readOperators_();
  var catalog = readMarkets_();                     // {names:[], tabOf:{name: tab}}
  var plan = ss.getSheetByName(PLAN.sheet);
  var date = plan.getRange(PLAN.dateCell).getValue();
  var rows = plan.getRange(PLAN.firstRow, 1, MAX_MARKETS, PLAN.dateCol).getValues();

  // ---- check the Plan before changing anything
  var problems = [];
  if (!(date instanceof Date)) problems.push('Plan ' + PLAN.dateCell + ' needs the market date.');
  var seen = {}, active = [];
  rows.forEach(function (r, i) {
    var m = String(r[PLAN.marketCol - 1]).trim();
    if (!m) return;
    var rowNo = PLAN.firstRow + i;
    if (!catalog.tabOf.hasOwnProperty(m)) {
      problems.push('Plan row ' + rowNo + ': "' + m + '" is not in the market list on the Lists tab.');
      return;
    }
    if (seen[m]) { problems.push('"' + m + '" is in Plan twice (rows ' + seen[m] + ' and ' + rowNo + ').'); return; }
    seen[m] = rowNo;
    var own = r[PLAN.dateCol - 1];
    if (own !== '' && own !== null && !(own instanceof Date)) {
      problems.push('Plan row ' + rowNo + ': the date in column Q isn\'t a date. Leave it blank to use ' + PLAN.dateCell + '.');
      return;
    }
    var total = Number(r[PLAN.totalCol - 1]) || 0;
    if (total > 0) active.push({ name: m, op: String(r[PLAN.operatorCol - 1]).trim(), i: i, date: own instanceof Date ? own : null });
  });
  var tabUsers = {};
  catalog.names.forEach(function (m) {
    var t = catalog.tabOf[m];
    if (FIXED_TABS.indexOf(t) >= 0) problems.push('Lists: the tab name "' + t + '" for ' + m + ' is already used by a main tab. Pick another tab name.');
    if (tabUsers[t]) problems.push('Lists: ' + tabUsers[t] + ' and ' + m + ' have the same tab name "' + t + '".');
    tabUsers[t] = m;
  });
  if (!active.length) problems.push('No market in Plan has bowls planned. Enter this week\'s bowls, then run this again.');
  if (problems.length) { ui.alert('Nothing was changed. Please fix this first:\n\n• ' + problems.join('\n• ')); return; }

  // ---- form choices: only this week's markets
  var activeNames = active.map(function (a) { return a.name; });
  var marketItem = findItem_(form, Q.market).asListItem();
  var operatorItem = findItem_(form, Q.operator).asListItem();
  var dateItem = findItem_(form, Q.date).asDateItem();
  marketItem.setChoiceValues(activeNames);
  operatorItem.setChoiceValues(operators);

  // ---- report links (blank for rows that aren't running)
  var links = rows.map(function () { return ['']; });
  var formDateOf = function (d) {   // the sheet's calendar date, as the form should show it
    var dp = Utilities.formatDate(d, tz, 'yyyy-MM-dd').split('-').map(Number);
    return new Date(dp[0], dp[1] - 1, dp[2], 12);
  };
  active.forEach(function (a) {
    a.day = a.date || date;
    var resp = form.createResponse()
      .withItemResponse(dateItem.createResponse(formDateOf(a.day)))
      .withItemResponse(marketItem.createResponse(a.name));
    if (a.op && operators.indexOf(a.op) >= 0) resp.withItemResponse(operatorItem.createResponse(a.op));
    links[a.i] = [resp.toPrefilledUrl()];
  });
  plan.getRange(PLAN.firstRow, PLAN.linkCol, MAX_MARKETS, 1).setValues(links);

  // ---- tabs: show / create running markets in Plan order, hide the rest
  var created = [], hidden = [];
  var pos = ss.getSheetByName(RESULTS.sheet).getIndex();
  active.forEach(function (a) {
    var tabName = catalog.tabOf[a.name];
    var sh = ss.getSheetByName(tabName);
    if (!sh) {
      sh = ss.insertSheet(tabName);
      buildMarketTab_(sh, a.name);
      created.push(tabName);
    } else if (String(sh.getRange('A1').getValue()).trim() !== a.name) {
      buildMarketTab_(sh, a.name);                  // market renamed in Lists
    }
    if (sh.isSheetHidden()) sh.showSheet();
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(++pos);
  });
  ss.setActiveSheet(plan);
  catalog.names.forEach(function (m) {
    if (activeNames.indexOf(m) >= 0) return;
    var sh = ss.getSheetByName(catalog.tabOf[m]);
    if (sh && !sh.isSheetHidden()) { sh.hideSheet(); hidden.push(catalog.tabOf[m]); }
  });

  var trig = ensureSubmitTrigger_(form);
  try { ensureWebSyncTrigger_(); } catch (e) { /* not authorized yet: "Sync website orders now" sets it up */ }
  var msg = 'Week of ' + Utilities.formatDate(date, tz, 'EEE M/d') + ' is ready.\n\n' +
            'Running (' + active.length + '): ' + active.map(function (a) {
              return a.name + (a.date ? ' (' + Utilities.formatDate(a.day, tz, 'EEE M/d') + ')' : '');
            }).join(', ') + '\n';
  if (created.length) msg += 'New tabs made: ' + created.join(', ') + '\n';
  if (hidden.length) msg += 'Tabs hidden (not running): ' + hidden.join(', ') + '\n';
  var noOp = active.filter(function (a) { return !a.op; }).map(function (a) { return a.name; });
  if (noOp.length) msg += '\nNo operator picked yet for: ' + noOp.join(', ') + ' (their link still works; they choose their name in the form).';
  if (trig) msg += '\n\n' + trig;
  ui.alert(msg);
}
function updateFormAndLinks() { updateWeek(); }   // old menu name

// ======================================================================
// Add a market (appends to the Lists tab)
// ======================================================================
function addMarket() {
  var ui = SpreadsheetApp.getUi();
  var r1 = ui.prompt('Add a new market', 'Market name (as you want it in Plan and in the form):', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var name = r1.getResponseText().trim();
  if (!name) return;
  var catalog = readMarkets_();
  if (catalog.tabOf.hasOwnProperty(name)) { ui.alert('"' + name + '" is already in the list.'); return; }
  var r2 = ui.prompt('Tab name for ' + name, 'Short name for its tab (leave blank to use "' + name + '"):', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var tab = r2.getResponseText().trim() || name;
  if (FIXED_TABS.indexOf(tab) >= 0) { ui.alert('"' + tab + '" is already used by a main tab. Try again with another tab name.'); return; }
  for (var m in catalog.tabOf) {
    if (catalog.tabOf[m] === tab) { ui.alert('The tab name "' + tab + '" is already used by ' + m + '. Try again with another tab name.'); return; }
  }
  var lists = SpreadsheetApp.getActive().getSheetByName(LISTS.sheet);
  var rng = lists.getRange(LISTS.markets);
  var vals = rng.getValues();
  for (var i = 0; i < vals.length; i++) {
    if (!String(vals[i][0]).trim()) {
      rng.offset(i, 0, 1, 2).setValues([[name, tab === name ? '' : tab]]);
      ui.alert(name + ' was added.\n\nPick it in a Plan row, enter its bowls, then run "Update this week". Its tab is made then.');
      return;
    }
  }
  ui.alert('The market list is full (30). Remove a market you no longer do from the Lists tab first.');
}

// ======================================================================
// One-time upgrade from the fixed 8-market layout
// ======================================================================
function upgradeToFlexibleMarkets() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getDocumentProperties();
  if (props.getProperty('LAYOUT') === '2') { ui.alert('This sheet is already upgraded.'); return; }
  var ss = SpreadsheetApp.getActive();
  var plan = ss.getSheetByName(PLAN.sheet);
  var results = ss.getSheetByName(RESULTS.sheet);
  var lists = ss.getSheetByName(LISTS.sheet);

  // Find the current market block: rows 9 .. the row above "Pickup / Pre-orders"
  var colA = plan.getRange(PLAN.firstRow, 1, 40, 1).getValues();
  var pickupRow = -1;
  for (var i = 0; i < colA.length; i++) {
    if (/^pickup/i.test(String(colA[i][0]).trim())) { pickupRow = PLAN.firstRow + i; break; }
  }
  if (pickupRow < 0) { ui.alert('Could not find the "Pickup / Pre-orders" row on Plan. Nothing was changed.'); return; }
  var count = pickupRow - PLAN.firstRow;          // markets today (8)
  var add = MAX_MARKETS - count;

  // Lists column D must be free for tab names
  var dVals = lists.getRange('D1:D31').getValues();
  if (dVals.some(function (r) { return String(r[0]).trim() !== ''; })) {
    ui.alert('Lists column D (D1:D31) is not empty, and the upgrade needs it for tab names. Nothing was changed.');
    return;
  }

  var ok = ui.alert('Upgrade to flexible markets',
    'This will:\n' +
    '1. Save a backup copy of this sheet in your Google Drive\n' +
    '2. Give Plan ' + MAX_MARKETS + ' market rows (now ' + count + ')\n' +
    '3. Add a "Tab name" column to Lists\n' +
    '4. Rebuild Results and the market tabs so they follow whatever markets you put in Plan\n\n' +
    'Your Plan numbers and form responses are kept. Continue?', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  // 1. backup
  DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + ' (backup before flexible markets)');

  // Map each market to its current tab (old tabs have the market name in A1)
  var oldTabOf = {};
  ss.getSheets().forEach(function (sh) {
    if (FIXED_TABS.indexOf(sh.getName()) >= 0) return;
    var a1 = String(sh.getRange('A1').getValue()).trim();
    if (a1 && !oldTabOf[a1]) oldTabOf[a1] = sh.getName();
  });

  // 2. Plan: insert rows inside the block so totals (SUM ranges) stretch to cover them
  if (add > 0) {
    var lastMarketRow = pickupRow - 1;
    plan.insertRowsBefore(lastMarketRow, add);
    var tmpl = plan.getRange(PLAN.firstRow, 1, 1, PLAN.linkCol);
    var fresh = plan.getRange(lastMarketRow, 1, add, PLAN.linkCol);
    tmpl.copyTo(fresh);                                          // formulas, formats, drop-downs
    // clear the inputs in the new rows (A–I, L–P); J and K keep their formulas
    plan.getRange(lastMarketRow, 1, add, 9).clearContent();
    plan.getRange(lastMarketRow, 12, add, 5).clearContent();
  }
  applyPlanDropdowns_();

  // 3. Lists: tab names
  lists.getRange('D1').setValue('Tab name (blank = market name)').setFontWeight('bold');
  var names = lists.getRange('C2:C31').getValues();
  lists.getRange('D2:D31').setValues(names.map(function (r) {
    var m = String(r[0]).trim();
    var t = oldTabOf[m];
    return [t && t !== m ? t : ''];
  }));

  // 4a. Results: same inserting trick, then rewrite every row's formulas
  var resultsCount = count;
  if (add > 0) {
    var lastResRow = RESULTS.firstRow + resultsCount - 1;
    results.insertRowsBefore(lastResRow, add);
    results.getRange(RESULTS.firstRow, 1, 1, results.getMaxColumns())
           .copyTo(results.getRange(lastResRow, 1, add, results.getMaxColumns()));
  }
  writeResultsFormulas_(results);

  // 4b. market tabs: rebuild every one that belongs to a market in Lists
  readMarkets_().names.forEach(function (m) {
    var sh = ss.getSheetByName(oldTabOf[m] || m);
    if (sh) buildMarketTab_(sh, m);
  });

  props.setProperty('LAYOUT', '2');
  onOpen();
  ui.alert('Upgrade done. A backup copy is in your Google Drive.\n\n' +
           'From now on: fill in Plan (only give bowls to markets that are running), then run ' +
           '"Update this week".');
}

// Results row r mirrors Plan row r + 4 (Results 5–19 ↔ Plan 9–23). Excel-safe formulas only.
function writeResultsFormulas_(sh) {
  var off = PLAN.firstRow - RESULTS.firstRow;
  var R = 'Responses!';
  var f = [], v = [];
  for (var r = RESULTS.firstRow; r <= RESULTS.lastRow; r++) {
    var p = r + off, B = '$B' + r, V = '$V' + r;
    var ifB = function (x) { return '=IF(' + B + '="","",' + x + ')'; };
    var resp = function (col) { return '=IF(' + V + '="","",INDEX(' + R + '$' + col + '$2:$' + col + '$2000,' + V + '))'; };
    f.push([
      ifB('IF(Plan!$Q' + p + '="",Plan!$B$4,Plan!$Q' + p + ')'),  // A Date (row's own date, else B4)
      '=IF(Plan!$A' + p + '="","",Plan!$A' + p + ')',              // B Market
      ifB('Plan!$B' + p),                                          // C Operator
      ifB('Plan!$J' + p),                                          // D Bowls collected
      '=IF(' + V + '="","",SUM(INDEX(' + R + '$E$2:$J$2000,' + V + ',0)))', // E Bowls returned
      ifB('Plan!$L' + p), resp('K'),                               // F,G Schug side
      ifB('Plan!$M' + p), resp('L'),                               // H,I Garlic aioli
      ifB('Plan!$N' + p), resp('M'),                               // J,K Baba ganoush
      resp('N'), resp('O'), resp('P'),                             // L Donated, M Bowls for tokens, N Tokens
      ifB('Plan!$C' + p),                                          // O Starting cash
      resp('Q'), resp('R'),                                        // P Stall fee, Q Ending cash
      ifB('IF(N(Plan!$J' + p + ')=0,"no bowls planned",IF(' + V + '="","waiting for operator","submitted"))'), // R Status
      resp('S'), resp('D')                                         // S Comments, T Submitted by
    ]);
    v.push(['=IF(' + B + '="","",IFERROR(MATCH(TEXT($A' + r + ',"yyyy-mm-dd")&"|"&' + B + ',' + R + '$T$2:$T$2000,0),""))']);
  }
  sh.getRange(RESULTS.firstRow, 1, MAX_MARKETS, 20).setFormulas(f);
  sh.getRange(RESULTS.firstRow, 22, MAX_MARKETS, 1).setFormulas(v);
  sh.getRange(RESULTS.firstRow, 1, MAX_MARKETS, 1).setNumberFormat('mm/dd/yyyy');
  sh.hideColumns(22);
}

// A market tab: read-only view of that market's Plan row, found by name (so Plan order doesn't matter)
function buildMarketTab_(sh, market) {
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { p.remove(); });
  if (sh.getMaxColumns() < 8) sh.insertColumnsAfter(sh.getMaxColumns(), 8 - sh.getMaxColumns());
  if (sh.getMaxRows() < 30) sh.insertRowsAfter(sh.getMaxRows(), 30 - sh.getMaxRows());
  var all = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  all.breakApart();
  sh.clear();
  sh.clearConditionalFormatRules();
  all.setDataValidation(null);
  sh.showColumns(1, sh.getMaxColumns());

  var lastPlan = PLAN.lastRow, first = PLAN.firstRow;
  var col = function (c) { return 'Plan!$' + c + '$' + first + ':$' + c + '$' + lastPlan; };
  var H = '$H$1';
  var pick = function (c) { return '=IF(' + H + '="","",INDEX(' + col(c) + ',' + H + '))'; };

  sh.getRange('A1').setValue(market);
  sh.getRange('H1').setFormula('=IFERROR(MATCH($A$1,' + col('A') + ',0),"")');
  sh.getRange('A2').setFormula('=IF(' + H + '="","Not running this week",IF(INDEX(' + col('Q') + ',' + H + ')="",Plan!$B$4,INDEX(' + col('Q') + ',' + H + ')))')
    .setNumberFormat('dddd, mmmm d');

  sh.getRange('A4:A6').setValues([['Operator'], ['Starting cash'], ['Note from Alon']]);
  sh.getRange('B4:B6').setFormulas([[pick('B')], [pick('C')], [pick('O')]]);
  sh.getRange('B5').setNumberFormat('$#,##0.00');

  sh.getRange('A8').setValue('Collect from the kitchen');
  var items = BOWLS.concat(['Total bowls', 'Pitas']).concat(SIDES);   // Plan D..N in this order
  sh.getRange(9, 1, items.length, 1).setValues(items.map(function (x) { return [x]; }));
  sh.getRange(9, 2, items.length, 1).setFormulas(items.map(function (x, k) {
    return ['=IF(' + H + '="","",INDEX(Plan!$D$' + first + ':$N$' + lastPlan + ',' + H + ',' + (k + 1) + '))'];
  }));
  var linkRow = 9 + items.length + 1;          // 21
  sh.getRange(linkRow, 1).setFormula(
    '=IF(' + H + '="","",IF(INDEX(' + col('P') + ',' + H + ')="","Report link not ready yet",' +
    'HYPERLINK(INDEX(' + col('P') + ',' + H + '),"After-market report: tap here after the market")))');
  sh.getRange(linkRow + 1, 1).setValue('Report status');
  sh.getRange(linkRow + 1, 2).setFormula('=IF(' + H + '="","",IFERROR(INDEX(Results!$R$' + RESULTS.firstRow + ':$R$' + RESULTS.lastRow +
    ',MATCH($A$1,Results!$B$' + RESULTS.firstRow + ':$B$' + RESULTS.lastRow + ',0)),""))');

  // look
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setFontFamily('Arial').setFontSize(11);
  sh.getRange('A1').setFontSize(18).setFontWeight('bold').setFontColor(OLIVE);
  sh.getRange('A2').setFontColor('#666666').setHorizontalAlignment('left');
  sh.getRange('A4:A6').setFontColor('#666666');
  sh.getRange('B4:B6').setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange('A8:B8').merge().setFontWeight('bold').setFontColor('#FFFFFF').setBackground(OLIVE);
  sh.getRange(9, 2, items.length, 1).setHorizontalAlignment('right').setNumberFormat('0');
  sh.getRange(9 + BOWLS.length, 1, 1, 2).setFontWeight('bold').setBorder(true, null, null, null, null, null);
  sh.getRange(linkRow, 1, 1, 2).merge().setFontWeight('bold').setFontSize(12).setBackground('#E8EFE3')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(linkRow, 36);
  sh.getRange(linkRow + 1, 1).setFontColor('#666666');
  sh.getRange(linkRow + 1, 2).setFontWeight('bold').setHorizontalAlignment('right');
  sh.setColumnWidth(1, 190);
  sh.setColumnWidth(2, 230);
  sh.hideColumns(8);
  sh.setTabColor(OLIVE);

  var prot = sh.protect().setDescription('Read-only: filled in from Plan');
  prot.removeEditors(prot.getEditors());
  if (prot.canDomainEdit()) prot.setDomainEdit(false);
}

// ======================================================================
// Online pre-orders: Squarespace orders CSV → Pickups / Deliveries tabs
// ======================================================================
function showImportOrders() {
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.4">' +
    '<p>Choose the orders CSV you downloaded from Squarespace (Orders → Download CSV). ' +
    'Only orders that aren\'t fulfilled or cancelled are imported.</p>' +
    '<input type="file" id="f" accept=".csv,text/csv">' +
    '<p><button id="go" onclick="go()">Import</button></p>' +
    '<div id="msg" style="white-space:pre-line"></div></div>' +
    '<script>' +
    'function msg(t){document.getElementById("msg").textContent=t;}' +
    'function go(){var f=document.getElementById("f").files[0];if(!f){msg("Pick the CSV file first.");return;}' +
    'var b=document.getElementById("go");b.disabled=true;msg("Importing…");' +
    'var r=new FileReader();r.onload=function(){google.script.run' +
    '.withSuccessHandler(function(s){msg(s);b.disabled=false;})' +
    '.withFailureHandler(function(e){msg("Problem: "+e.message);b.disabled=false;})' +
    '.importOrdersCsv(r.result,f.name);};r.readAsText(f,"UTF-8");}' +
    '</script>').setWidth(460).setHeight(330);
  SpreadsheetApp.getUi().showModalDialog(html, 'Import pending orders');
}

// Called from the dialog with the CSV text. Rebuilds both tabs; keeps Done ticks by order number.
function importOrdersCsv(text, fileName) {
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();
  var rows = Utilities.parseCsv(String(text).replace(/^/, ''));
  if (rows.length < 2) throw new Error('The file is empty.');
  var ix = {};
  rows[0].forEach(function (n, i) { ix[String(n).trim()] = i; });
  ['Order ID', 'Fulfillment Status', 'Shipping Method', 'Lineitem quantity', 'Lineitem name'].forEach(function (need) {
    if (!(need in ix)) throw new Error('This doesn\'t look like a Squarespace orders export (no "' + need + '" column).');
  });
  var noteCols = rows[0].map(function (n, i) { return /^checkout form/i.test(String(n).trim()) ? i : -1; })
                        .filter(function (i) { return i >= 0; });
  var get = function (r, n) { var i = ix[n]; return i === undefined ? '' : String(r[i] == null ? '' : r[i]).trim(); };

  // group line-item rows into orders (only the first row of an order has the customer details)
  var orders = {}, ids = [];
  rows.slice(1).forEach(function (r) {
    var id = get(r, 'Order ID');
    if (!id) return;
    var o = orders[id];
    if (!o) { o = orders[id] = { id: id, head: r, items: {}, other: [] }; ids.push(id); }
    else if (!get(o.head, 'Shipping Method') && get(r, 'Shipping Method')) o.head = r;
    var name = get(r, 'Lineitem name');
    if (!name) return;
    var qty = Number(get(r, 'Lineitem quantity')) || 0;
    var col = mapProduct_(name);
    if (col) o.items[col] = (o.items[col] || 0) + qty;
    else o.other.push(qty + ' × ' + name);
  });

  var pickups = [], deliveries = [], skipped = 0, unknown = {};
  ids.forEach(function (id) {
    var o = orders[id], h = o.head;
    var status = get(h, 'Fulfillment Status').toUpperCase();
    if (status === 'FULFILLED' || get(h, 'Cancelled at') || /REFUNDED|VOIDED/i.test(get(h, 'Financial Status'))) { skipped++; return; }
    var method = get(h, 'Shipping Method');
    var hasShipAddr = !!get(h, 'Shipping Address1');
    var isPickup = /pick\s*-?up/i.test(method) || (!/deliver/i.test(method) && !hasShipAddr);
    var pre = isPickup ? 'Billing ' : (hasShipAddr ? 'Shipping ' : 'Billing ');
    var other = isPickup ? 'Shipping ' : 'Billing ';
    var name = get(h, pre + 'Name') || get(h, other + 'Name') || get(h, 'Email');
    var phone = formatPhone_(get(h, pre + 'Phone') || get(h, other + 'Phone'));
    var place;
    if (isPickup) {
      place = method.replace(/^pick\s*-?up\s*(from|at|in)?\s*/i, '').trim() || method;
    } else {
      var addr = [get(h, pre + 'Address1'), get(h, pre + 'Address2'),
                  [get(h, pre + 'City'), get(h, pre + 'Zip')].filter(String).join(' ')].filter(String).join(', ');
      place = addr ? '=HYPERLINK("https://www.google.com/maps/search/?api=1&query=' +
                     encodeURIComponent(addr) + '","' + addr.replace(/"/g, '""') + '")' : '(no address)';
    }
    var notes = noteCols.map(function (i) { return String(h[i] || '').trim(); }).filter(String);
    if (get(h, 'Private Notes')) notes.push('(private) ' + get(h, 'Private Notes'));
    o.other.forEach(function (x) { unknown[x.replace(/^\d+ × /, '')] = true; });

    var itemVals = ORDER_ITEMS.map(function (c) {
      if (c === 'Total bowls') return BOWLS.reduce(function (s, b) { return s + (o.items[b] || 0); }, 0);
      return o.items[c] || '';
    });
    var row = {
      when: parseOrderDate_(get(h, 'Created at')),
      vals: [false, safeText_(id), parseOrderDate_(get(h, 'Created at')) || get(h, 'Created at'),
             safeText_(name), phone, isPickup ? safeText_(place) : place]
            .concat(itemVals)
            .concat([safeText_(o.other.join(', ')), safeText_(notes.join(' · ')), Number(get(h, 'Total')) || ''])
    };
    (isPickup ? pickups : deliveries).push(row);
  });

  // keep the website orders already on the tabs (they come from the website sync, not this file)
  pickups = pickups.concat(readOrderRows_(ORDERS.pickupTab, true));
  deliveries = deliveries.concat(readOrderRows_(ORDERS.deliveryTab, true));
  var byDate = function (a, b) { return (a.when ? a.when.getTime() : 0) - (b.when ? b.when.getTime() : 0); };
  pickups.sort(byDate); deliveries.sort(byDate);
  var stamp = 'Updated ' + Utilities.formatDate(new Date(), tz, 'EEE M/d h:mm a') + ' from ' + (fileName || 'CSV');
  var pb = writeOrderTab_(ORDERS.pickupTab, 'Pickups — pending online orders', 'Pickup at', pickups, stamp);
  var db = writeOrderTab_(ORDERS.deliveryTab, 'Deliveries — pending online orders', 'Address (tap for map)', deliveries, stamp);
  var planMsg = linkPlanPreorders_();

  var msg = 'Pickups: ' + pickups.length + ' order' + (pickups.length === 1 ? '' : 's') + ' (' + pb + ' bowls)\n' +
            'Deliveries: ' + deliveries.length + ' order' + (deliveries.length === 1 ? '' : 's') + ' (' + db + ' bowls)\n' +
            'Skipped (fulfilled or cancelled): ' + skipped + '\n\n' + planMsg;
  var unk = Object.keys(unknown);
  if (unk.length) msg += '\n\nNot matched to a bowl or side, so not counted in Plan (shown under "Other items"):\n• ' + unk.join('\n• ');
  return msg;
}

function writeOrderTab_(tabName, title, placeHeader, list, stamp) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(tabName);
  var created = false;
  if (!sh) {
    var lists = ss.getSheetByName(LISTS.sheet);
    sh = ss.insertSheet(tabName, lists ? lists.getIndex() - 1 : ss.getNumSheets());
    created = true;
  }
  var headers = ['Done', 'Order #', 'Ordered', 'Customer', 'Phone', placeHeader]
    .concat(ORDER_ITEMS).concat(['Other items', 'Customer notes', 'Total paid']);
  var W = headers.length, F = ORDERS.firstRow, N = ORDERS.maxRows;

  // remember Done ticks by order number
  var done = {};
  if (!created) {
    sh.getRange(F, 1, N, 2).getValues().forEach(function (r) { if (r[0] === true) done[String(r[1])] = true; });
  }
  list.forEach(function (o) { if (done[String(o.vals[1]).replace(/^'/, '')]) o.vals[0] = true; });

  if (created) {
    sh.getRange(1, 1).setValue(title).setFontSize(16).setFontWeight('bold').setFontColor(OLIVE);
    sh.getRange(4, 1, 1, W).setValues([headers]).setFontWeight('bold').setFontColor('#FFFFFF')
      .setBackground(OLIVE).setWrap(true).setVerticalAlignment('middle');
    sh.setFrozenRows(4);
    sh.setColumnWidth(1, 50); sh.setColumnWidth(2, 70); sh.setColumnWidth(3, 110); sh.setColumnWidth(4, 160);
    sh.setColumnWidth(5, 120); sh.setColumnWidth(6, 260);
    for (var c = ORDER_ITEM_COL; c < ORDER_ITEM_COL + ORDER_ITEMS.length; c++) sh.setColumnWidth(c, 72);
    sh.setColumnWidth(W - 2, 180); sh.setColumnWidth(W - 1, 240); sh.setColumnWidth(W, 80);
    sh.setTabColor('#B5651D');
  }
  sh.getRange(4, 6).setValue(placeHeader);
  sh.getRange(2, 1).setValue(stamp + ' · ' + list.length + ' pending').setFontColor('#666666');

  // row 3: what's still to make (orders not ticked Done)
  sh.getRange(3, 1, 1, W).clearContent();
  sh.getRange(3, ORDER_ITEM_COL - 1).setValue('Still to make →').setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange(3, ORDER_ITEM_COL, 1, ORDER_ITEMS.length).setFormulas([ORDER_ITEMS.map(function (x, k) {
    var L = colLetter_(ORDER_ITEM_COL + k);
    return '=SUMIFS(' + L + '$' + F + ':' + L + '$' + (F + N - 1) + ',$A$' + F + ':$A$' + (F + N - 1) + ',FALSE)';
  })]).setFontWeight('bold').setHorizontalAlignment('center');

  // data
  var body = sh.getRange(F, 1, N, W);
  body.clearContent().clearDataValidations();
  body.setFontFamily('Arial').setFontSize(10).setVerticalAlignment('top').setWrap(true);
  sh.getRange(F, 2, N, 1).setNumberFormat('@');     // keep order numbers like 02210 as text
  if (list.length) {
    sh.getRange(F, 1, list.length, W).setValues(list.map(function (o) { return o.vals; }));
    sh.getRange(F, 1, list.length, 1).insertCheckboxes();
    list.forEach(function (o, i) { if (o.vals[0] === true) sh.getRange(F + i, 1).check(); });
  }
  sh.getRange(F, 3, N, 1).setNumberFormat('ddd m/d h:mm am/pm');
  sh.getRange(F, ORDER_ITEM_COL, N, ORDER_ITEMS.length).setHorizontalAlignment('center');
  sh.getRange(F, W, N, 1).setNumberFormat('$#,##0.00');
  sh.getRange(1, 1, 3 + N + 1, W).setFontFamily('Arial');

  var totalIdx = ORDER_ITEMS.indexOf('Total bowls') + 6;
  return list.reduce(function (s, o) { return s + (o.vals[0] === true ? 0 : (Number(o.vals[totalIdx]) || 0)); }, 0);
}

// Plan's "Pickup / Pre-orders" row = bowls and sides from both tabs, orders not ticked Done
function linkPlanPreorders_() {
  var plan = SpreadsheetApp.getActive().getSheetByName(PLAN.sheet);
  var colA = plan.getRange(PLAN.firstRow, 1, 60, 1).getValues();
  var row = -1;
  for (var i = 0; i < colA.length; i++) {
    if (/^pick\s*-?up/i.test(String(colA[i][0]).trim())) { row = PLAN.firstRow + i; break; }
  }
  if (row < 0) return 'Could not find the "Pickup / Pre-orders" row on Plan, so Plan was not updated.';
  var F = ORDERS.firstRow, Lr = F + ORDERS.maxRows - 1;
  var sumBoth = function (item) {
    var L = colLetter_(ORDER_ITEM_COL + ORDER_ITEMS.indexOf(item));
    return [ORDERS.pickupTab, ORDERS.deliveryTab].map(function (t) {
      return 'SUMIFS(' + t + '!$' + L + '$' + F + ':$' + L + '$' + Lr + ',' + t + '!$A$' + F + ':$A$' + Lr + ',FALSE)';
    }).join('+');
  };
  plan.getRange(row, 4, 1, BOWLS.length).setFormulas([BOWLS.map(function (b) { return '=' + sumBoth(b); })]);   // D–I
  plan.getRange(row, 12, 1, SIDES.length).setFormulas([SIDES.map(function (s) { return '=' + sumBoth(s); })]);  // L–N
  return 'Plan row ' + row + ' (Pickup / Pre-orders) now adds up these orders automatically. ' +
         'Tick Done on an order once it\'s handed over and it drops out of the count.';
}

function mapProduct_(name) {
  var n = String(name).toLowerCase();
  for (var i = 0; i < ORDERS.products.length; i++) if (ORDERS.products[i].re.test(n)) return ORDERS.products[i].col;
  return null;
}
function parseOrderDate_(s) {   // "2026-10-01 13:28:28 -0400"
  var m = String(s || '').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
  return m ? new Date(m[1] + 'T' + m[2] + m[3] + ':' + m[4]) : null;
}
function formatPhone_(p) {
  var d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : safeText_(String(p || '').replace(/^'/, ''));
}
function safeText_(s) {         // keep customer text from being read as a formula
  s = String(s == null ? '' : s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ======================================================================
// Website orders → Pickups / Deliveries (version 7)
// ======================================================================
function syncWebOrdersMenu() {
  var ui = SpreadsheetApp.getUi();
  try {
    var trig = ensureWebSyncTrigger_();
    ui.alert(syncWebOrders_() + (trig ? '\n\n' + trig : ''));
  } catch (e) {
    ui.alert('Website orders could not be synced:\n\n' + e.message);
  }
}
function syncWebOrdersTimer() {          // runs every 15 minutes, no pop-ups
  try { syncWebOrders_(); } catch (e) { console.log('Website order sync failed: ' + e.message); }
}

function syncWebOrders_() {
  var res = UrlFetchApp.fetch(WEB.url, { method: 'get', headers: { 'X-Ops-Key': WEB.key }, muteHttpExceptions: true });
  var code = res.getResponseCode();
  var data = {};
  try { data = JSON.parse(res.getContentText()); } catch (e) { }
  if (code !== 200 || !data.ok) {
    throw new Error(code === 403 ? 'The website refused the key. Check WEB.key at the top of the script.'
                                 : 'The website did not answer (' + code + (data.error ? ': ' + data.error : '') + '). Nothing was changed.');
  }
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
    var pickups = readOrderRows_(ORDERS.pickupTab, false), deliveries = readOrderRows_(ORDERS.deliveryTab, false);
    var nP = 0, nD = 0, unknown = {};
    (data.orders || []).forEach(function (o) {
      var row = webOrderRow_(o, tz, unknown);
      if (o.mode === 'pickup') { pickups.push(row); nP++; } else { deliveries.push(row); nD++; }
    });
    var byDate = function (a, b) { return (a.when ? a.when.getTime() : 0) - (b.when ? b.when.getTime() : 0); };
    pickups.sort(byDate); deliveries.sort(byDate);
    var stamp = 'Updated ' + Utilities.formatDate(new Date(), tz, 'EEE M/d h:mm a') + ' (website orders sync automatically)';
    writeOrderTab_(ORDERS.pickupTab, 'Pickups — pending online orders', 'Pickup at', pickups, stamp);
    writeOrderTab_(ORDERS.deliveryTab, 'Deliveries — pending online orders', 'Address (tap for map)', deliveries, stamp);
    linkPlanPreorders_();
    var msg = 'Website orders synced: ' + nP + ' pickup, ' + nD + ' delivery.';
    var unk = Object.keys(unknown);
    if (unk.length) msg += '\n\nNot matched to a column (shown under "Other items"):\n• ' + unk.join('\n• ');
    return msg;
  } finally {
    lock.releaseLock();
  }
}

// One website order → a row in the same shape importOrdersCsv writes (no email, no money).
function webOrderRow_(o, tz, unknown) {
  var counts = {}, other = [];
  (o.items || []).forEach(function (i) {
    if (i.col && ORDER_ITEMS.indexOf(i.col) >= 0) counts[i.col] = (counts[i.col] || 0) + Number(i.qty || 0);
    else { other.push(i.qty + ' × ' + i.name); unknown[i.name] = true; }
  });
  var itemVals = ORDER_ITEMS.map(function (c) {
    if (c === 'Total bowls') return BOWLS.reduce(function (s, b) { return s + (counts[b] || 0); }, 0);
    return counts[c] || '';
  });
  var when = o.createdAt ? new Date(o.createdAt) : null;
  var day = o.date ? Utilities.formatDate(Utilities.parseDate(o.date, tz, 'yyyy-MM-dd'), tz, 'EEE M/d') : '';
  var place;
  if (o.mode === 'pickup') place = WEB.pickupPlace;
  else place = o.address ? '=HYPERLINK("https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address) +
                           '","' + String(o.address).replace(/"/g, '""') + '")' : '(no address)';
  var notes = 'Website order for ' + day + (o.note ? ' · Note: ' + o.note : '') + (o.notified ? ' · customer notified' : '');
  return {
    when: when,
    vals: [o.delivered === true, safeText_(o.number), when || '', safeText_(o.name || ''), formatPhone_(o.phone), o.mode === 'pickup' ? safeText_(place) : place]
          .concat(itemVals).concat([safeText_(other.join(', ')), safeText_(notes), ''])
  };
}

// Rows already on an order tab: web=true → only website rows, web=false → only the other (Squarespace) rows.
// Keeps Done ticks and the map links in column F.
function readOrderRows_(tabName, web) {
  var sh = SpreadsheetApp.getActive().getSheetByName(tabName);
  if (!sh) return [];
  var W = 6 + ORDER_ITEMS.length + 3, F = ORDERS.firstRow, N = ORDERS.maxRows;
  var rng = sh.getRange(F, 1, N, W);
  var vals = rng.getValues(), forms = sh.getRange(F, 6, N, 1).getFormulas();
  var out = [];
  vals.forEach(function (r, i) {
    var num = String(r[1]).trim();
    if (!num || isWebNumber_(num) !== web) return;
    var v = r.slice();
    v[0] = r[0] === true;
    v[1] = safeText_(num);
    if (forms[i][0]) v[5] = forms[i][0];
    else v[5] = safeText_(v[5]);
    out.push({ when: r[2] instanceof Date ? r[2] : null, vals: v });
  });
  return out;
}

function ensureWebSyncTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncWebOrdersTimer'; });
  if (has) return '';
  ScriptApp.newTrigger('syncWebOrdersTimer').timeBased().everyMinutes(WEB.everyMinutes).create();
  return 'Automatic sync is on: website orders will update every ' + WEB.everyMinutes + ' minutes.';
}

// ======================================================================
// One-time form setup (already done for this sheet; kept for rebuilding)
// ======================================================================
function setupForm() {
  var ss = SpreadsheetApp.getActive();
  var props = PropertiesService.getDocumentProperties();
  if (props.getProperty('FORM_ID')) {
    SpreadsheetApp.getUi().alert('The form already exists. Use "Update this week" instead.');
    return;
  }
  var form = FormApp.create("Hummus Y'all — After-Market Report");
  form.setDescription('Fill this in right after your market. Count everything before you submit. ' +
                      'If you make a mistake, just submit again — the newest report replaces the old one.');
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setProgressBar(false);
  form.setConfirmationMessage('Thanks! Your report is in.');

  form.addDateItem().setTitle(Q.date).setRequired(true);
  form.addListItem().setTitle(Q.market).setChoiceValues(['(loading)']).setRequired(true);
  form.addListItem().setTitle(Q.operator).setChoiceValues(['(loading)']).setRequired(true);

  form.addSectionHeaderItem().setTitle('Returned to the kitchen (unsold)')
      .setHelpText('Enter 0 if none came back.');
  var whole = FormApp.createTextValidation().setHelpText('Enter a whole number (0 or more).').requireWholeNumber().build();
  BOWLS.concat(SIDES).forEach(function (it) {
    form.addTextItem().setTitle(retTitle(it)).setValidation(whole).setRequired(true);
  });

  form.addSectionHeaderItem().setTitle('Bowls not rung up in Square');
  form.addTextItem().setTitle(Q.donated).setValidation(whole).setRequired(true);
  form.addTextItem().setTitle(Q.tokenBowls).setHelpText("Don't ring these up in Square.").setValidation(whole).setRequired(true);
  form.addTextItem().setTitle(Q.tokens).setHelpText('1 bowl = 15 tokens.').setValidation(whole).setRequired(true);

  form.addSectionHeaderItem().setTitle('Cash box');
  var dollars = FormApp.createTextValidation().setHelpText('Enter a dollar amount, e.g. 20 or 187.50').requireNumberGreaterThanOrEqualTo(0).build();
  form.addTextItem().setTitle(Q.fee).setHelpText('Enter 0 if you paid another way.').setValidation(dollars).setRequired(true);
  form.addTextItem().setTitle(Q.endCash).setHelpText('Cash sales are rounded to the nearest dollar.').setValidation(dollars).setRequired(true);

  form.addParagraphTextItem().setTitle(Q.comments)
      .setHelpText('How was the market? Samples, mistakes in Square, weather, sold-out time…');

  props.setProperty('FORM_ID', form.getId());
  ScriptApp.newTrigger('onReportSubmit').forForm(form).onFormSubmit().create();

  var lists = ss.getSheetByName(LISTS.sheet);
  lists.getRange(LISTS.editLinkCell).setValue(form.getEditUrl());
  lists.getRange(LISTS.formLinkCell).setValue(form.getPublishedUrl());

  SpreadsheetApp.getUi().alert('The form is created.\n\nForm (for editing): ' + form.getEditUrl() +
    '\n\nNext: fill in Plan and run "Update this week".');
}

// ======================================================================
// Submissions → Responses tab
// ======================================================================
function onReportSubmit(e) {
  writeResponse_(e.response);
}

function reimportAll() {
  var ss = SpreadsheetApp.getActive();
  var trig = ensureSubmitTrigger_(getForm_());
  var sh = ss.getSheetByName(RESP_SHEET);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  getForm_().getResponses().forEach(function (r) { writeResponse_(r); });
  var n = Math.max(sh.getLastRow() - 1, 0);
  SpreadsheetApp.getUi().alert('Re-imported ' + n + ' report' + (n === 1 ? '' : 's') + ' from the form. Results is up to date.' +
                               (trig ? '\n\n' + trig : ''));
}

function writeResponse_(response) {
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();
  var a = {};
  response.getItemResponses().forEach(function (ir) { a[ir.getItem().getTitle()] = ir.getResponse(); });

  // The form gives the date as text "yyyy-MM-dd". Use that text for the key, and make the sheet date at
  // midnight in the SHEET's time zone, so nothing shifts a day when the script's time zone is different.
  var ymd = parseDate_(a[Q.date]);
  var date = ymd ? Utilities.parseDate(ymd, tz, 'yyyy-MM-dd') : null;
  var market = a[Q.market] || '';
  var key = (ymd || '') + '|' + market;
  var num = function (t) { var v = a[t]; return (v === undefined || v === '') ? '' : Number(v); };

  var row = [response.getTimestamp(), date || a[Q.date], market, a[Q.operator] || '']
    .concat(BOWLS.concat(SIDES).map(function (it) { return num(retTitle(it)); }))
    .concat([num(Q.donated), num(Q.tokenBowls), num(Q.tokens), num(Q.fee), num(Q.endCash), safeText_(a[Q.comments] || ''), key]);

  var lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    var sh = ss.getSheetByName(RESP_SHEET);
    var last = sh.getLastRow();
    if (last > 1) {   // a newer report for the same market + date replaces the older one
      var keys = sh.getRange(2, 20, last - 1, 1).getValues();
      for (var i = keys.length - 1; i >= 0; i--) {
        if (keys[i][0] === key) sh.deleteRow(i + 2);
      }
    }
    sh.appendRow(row);
    sh.getRange(sh.getLastRow(), 2).setNumberFormat('mm/dd/yyyy');
  } finally {
    lock.releaseLock();
  }
}

// ======================================================================
// Per-row dates (Plan column Q). Runs once, from "Update this week": adds the column,
// then rewrites Results and every market tab so they use each row's own date.
// ======================================================================
function ensureRowDates_() {
  var props = PropertiesService.getDocumentProperties();
  if (props.getProperty('ROW_DATES') === '1') return;
  var ss = SpreadsheetApp.getActive();
  var plan = ss.getSheetByName(PLAN.sheet);
  if (plan.getMaxColumns() < PLAN.dateCol) plan.insertColumnsAfter(plan.getMaxColumns(), PLAN.dateCol - plan.getMaxColumns());
  var head = plan.getRange(PLAN.firstRow - 1, PLAN.dateCol);
  plan.getRange(PLAN.firstRow - 1, PLAN.linkCol).copyTo(head, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  head.setValue('Date if not ' + PLAN.dateCell + ' (e.g. Sunday pop-up)').setWrap(true)
      .setNote('Leave blank for markets on the main date (' + PLAN.dateCell + '). Type a date for a market on another day; ' +
               'its tab, report link and Results row use that date.');
  plan.getRange(PLAN.firstRow, PLAN.dateCol, MAX_MARKETS, 1)
      .setNumberFormat('ddd m/d').setBackground('#FFF2CC').setFontColor('#0000FF').setHorizontalAlignment('center')
      .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false)
        .setHelpText('A date, or leave blank to use ' + PLAN.dateCell + '.').build());
  plan.setColumnWidth(PLAN.dateCol, 120);
  if (/^market date$/i.test(String(plan.getRange('A4').getValue()).trim())) plan.getRange('A4').setValue('Main market date');

  writeResultsFormulas_(ss.getSheetByName(RESULTS.sheet));
  var catalog = readMarkets_();
  catalog.names.forEach(function (m) {
    var sh = ss.getSheetByName(catalog.tabOf[m]);
    if (sh) buildMarketTab_(sh, m);
  });
  props.setProperty('ROW_DATES', '1');
}

// ======================================================================
// Helpers
// ======================================================================
// Drop-downs on Plan: Market (A) from Lists C, Operator (B) from Lists A
function applyPlanDropdowns_() {
  var ss = SpreadsheetApp.getActive();
  var plan = ss.getSheetByName(PLAN.sheet);
  var lists = ss.getSheetByName(LISTS.sheet);
  var marketRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(lists.getRange('C2:C31'), true).setAllowInvalid(false)
    .setHelpText('Pick a market from the Lists tab. To add one: Hummus Y\'all menu → Add a new market.').build();
  var operatorRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(lists.getRange(LISTS.operators), true).setAllowInvalid(false)
    .setHelpText('Pick an operator from the Lists tab (column A).').build();
  plan.getRange(PLAN.firstRow, PLAN.marketCol, MAX_MARKETS, 1).setDataValidation(marketRule);
  plan.getRange(PLAN.firstRow, PLAN.operatorCol, MAX_MARKETS, 1).setDataValidation(operatorRule);
}
function readOperators_() {
  return SpreadsheetApp.getActive().getSheetByName(LISTS.sheet).getRange(LISTS.operators).getValues()
    .map(function (r) { return String(r[0]).trim(); }).filter(String);
}
function readMarkets_() {
  var vals = SpreadsheetApp.getActive().getSheetByName(LISTS.sheet).getRange(LISTS.markets).getValues();
  var names = [], tabOf = {};
  vals.forEach(function (r) {
    var m = String(r[0]).trim();
    if (!m || tabOf.hasOwnProperty(m)) return;
    names.push(m);
    tabOf[m] = String(r[1]).trim() || m;
  });
  return { names: names, tabOf: tabOf };
}
function getForm_() {
  var id = PropertiesService.getDocumentProperties().getProperty('FORM_ID');
  if (!id) throw new Error('Run "Set up the after-market form" first.');
  return FormApp.openById(id);
}
function findItem_(form, title) {
  var items = form.getItems();
  for (var i = 0; i < items.length; i++) if (items[i].getTitle() === title) return items[i];
  throw new Error('Question not found in the form: ' + title);
}
function parseDate_(s) {          // form date answer → 'yyyy-MM-dd' text (or null)
  if (!s) return null;
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
}
// New reports reach the Responses tab through an "on form submit" trigger. If it's missing
// (e.g. deleted, or the form was re-linked), make it again. Returns a note, or '' if all was fine.
function ensureSubmitTrigger_(form) {
  var ok = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'onReportSubmit' && t.getTriggerSourceId() === form.getId();
  });
  if (ok) return '';
  ScriptApp.newTrigger('onReportSubmit').forForm(form).onFormSubmit().create();
  return 'The automatic import of new reports was off and has been turned back on. ' +
         'Run "Re-import all form responses" once to bring in reports sent before now.';
}
