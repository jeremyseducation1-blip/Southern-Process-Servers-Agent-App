// The database library insists on a WebSocket being available when it starts.
// Newer Node versions have one built in; on older ones the "ws" package fills
// in, so the app works whichever Node version Netlify runs the functions on.
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = require('ws'); } catch (_) { /* nothing more we can do */ }
}
