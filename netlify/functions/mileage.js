const { requireAuth } = require('./lib/auth');
const { readStore, writeStore } = require('./lib/mileageStore');

// GET                      -> { home, trips }
// POST {action:'home', home}
// POST {action:'save', date, miles, stops[], note, estimated}
// POST {action:'delete', id}
exports.handler = requireAuth(async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      return { statusCode: 200, body: JSON.stringify(await readStore()) };
    }
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

    const body = JSON.parse(event.body || '{}');
    const store = await readStore();

    if (body.action === 'home') {
      store.home = String(body.home || '').trim();
    } else if (body.action === 'save') {
      const miles = Math.round(Number(body.miles) * 10) / 10;
      if (!isFinite(miles) || miles <= 0) return { statusCode: 400, body: 'Miles must be a number above 0.' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) return { statusCode: 400, body: 'A date (YYYY-MM-DD) is required.' };
      store.trips.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        date: body.date,
        miles,
        stops: Array.isArray(body.stops) ? body.stops.map(String).slice(0, 30) : [],
        note: String(body.note || '').slice(0, 300),
        estimated: !!body.estimated,
        savedAt: new Date().toISOString()
      });
    } else if (body.action === 'delete') {
      store.trips = store.trips.filter((t) => t.id !== body.id);
    } else {
      return { statusCode: 400, body: 'Unknown action.' };
    }

    await writeStore(store);
    return { statusCode: 200, body: JSON.stringify(store) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Mileage request failed' };
  }
});
