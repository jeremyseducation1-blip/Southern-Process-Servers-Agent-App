// Court-date / expiration priority. ONE rule set used by both the browser
// (public/js/priority.js) and the server (netlify/functions/lib/priority.js).
// The two files are identical copies -- change one, change the other.
//
// Expiration: General Sessions papers expire 60 days after they were
// issued; everything else 90. "Issued" is the date on the summons/warrant
// (c.issueDate). If that wasn't entered, the received date is used as an
// ESTIMATE and flagged as such.
//
// Levels (open cases only):
//   past - court date or expiration has already gone by
//   high - court in <= 7 days, or expires in <= 14 days
//   soon - court in <= 14 days, or expires in <= 30 days
//   ok   - nothing close
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SPSPriority = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var COURT_HIGH = 7, COURT_SOON = 14, EXPIRE_HIGH = 14, EXPIRE_SOON = 30;

  function todayCentral() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  }
  function toUTC(s) {
    var p = String(s).slice(0, 10).split('-').map(Number);
    if (!p[0] || !p[1] || !p[2]) return null;
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }
  function daysBetween(fromStr, toStr) {
    var a = toUTC(fromStr), b = toUTC(toStr);
    if (a == null || b == null) return null;
    return Math.round((b - a) / 86400000);
  }
  function addDays(dateStr, n) {
    var t = toUTC(dateStr);
    if (t == null) return null;
    return new Date(t + n * 86400000).toISOString().slice(0, 10);
  }
  function expirationDays(c) {
    return /general\s*sessions/i.test(c.courtType || '') ? 60 : 90;
  }
  function pretty(dateStr) {
    var p = String(dateStr).slice(0, 10).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function when(days) {
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    return 'in ' + days + ' days';
  }
  function ago(days) {
    var n = Math.abs(days);
    return n === 1 ? '1 day ago' : n + ' days ago';
  }

  function assess(c, today) {
    today = today || todayCentral();
    var courtDate = c.courtDate ? String(c.courtDate).slice(0, 10) : null;
    var base = c.issueDate || c.intakeDate || null;
    var estimated = !c.issueDate;
    var expiresOn = base ? addDays(String(base).slice(0, 10), expirationDays(c)) : null;
    var daysToCourt = courtDate ? daysBetween(today, courtDate) : null;
    var daysToExpire = expiresOn ? daysBetween(today, expiresOn) : null;

    var level = 'ok';
    var reasons = [];
    if (daysToCourt != null) {
      if (daysToCourt < 0) { level = 'past'; reasons.push('Court date passed ' + ago(daysToCourt) + ' (' + pretty(courtDate) + ')'); }
      else if (daysToCourt <= COURT_HIGH) { level = 'high'; reasons.push('Court ' + when(daysToCourt) + ' (' + pretty(courtDate) + ')'); }
      else if (daysToCourt <= COURT_SOON) { level = 'soon'; reasons.push('Court ' + when(daysToCourt) + ' (' + pretty(courtDate) + ')'); }
    }
    if (daysToExpire != null) {
      var tag = estimated ? ' (est.)' : '';
      var rank = { ok: 0, soon: 1, high: 2, past: 3 };
      var l = 'ok', r = null;
      if (daysToExpire < 0) { l = 'past'; r = 'Expired ' + ago(daysToExpire) + ' (' + pretty(expiresOn) + ')' + tag; }
      else if (daysToExpire <= EXPIRE_HIGH) { l = 'high'; r = 'Expires ' + when(daysToExpire) + ' (' + pretty(expiresOn) + ')' + tag; }
      else if (daysToExpire <= EXPIRE_SOON) { l = 'soon'; r = 'Expires ' + when(daysToExpire) + ' (' + pretty(expiresOn) + ')' + tag; }
      if (r) reasons.push(r);
      if (rank[l] > rank[level]) level = l;
    }
    var candidates = [daysToCourt, daysToExpire].filter(function (x) { return x != null; });
    var sortKey = candidates.length ? Math.min.apply(null, candidates) : 99999;
    return {
      level: level, reasons: reasons, courtDate: courtDate, expiresOn: expiresOn, estimated: estimated,
      daysToCourt: daysToCourt, daysToExpire: daysToExpire, sortKey: sortKey
    };
  }

  return { assess: assess, addDays: addDays, daysBetween: daysBetween, expirationDays: expirationDays, pretty: pretty, todayCentral: todayCentral };
});
