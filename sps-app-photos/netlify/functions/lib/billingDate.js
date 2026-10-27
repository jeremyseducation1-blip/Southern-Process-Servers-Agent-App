// Which date a completed return is BILLED on.
//
// The return date Jeremy types can be backdated (e.g. he wrote the return
// up Oct 1 but only got it into the app Oct 7). Invoices follow the day it
// was actually completed in the app (`completedDate`), so a backlogged
// return lands on the week it was entered, not a week that's already been
// invoiced. Older records without `completedDate` fall back to returnDate.

// Today's date in Central time, YYYY-MM-DD. Netlify runs in UTC, so a plain
// toISOString() after ~7pm Central would already be "tomorrow" and could
// even push a Sunday-evening entry into the next week.
function todayCentral() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

function billingDate(c) {
  return c.completedDate || c.returnDate || null;
}

module.exports = { todayCentral, billingDate };
