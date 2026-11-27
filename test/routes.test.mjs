import assert from 'node:assert/strict';
import { once } from 'node:events';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';
import test from 'node:test';
import { freshDaily } from '../lib/collect.mjs';
import { createApp } from '../server.mjs';

// Exercise Express routing with HTTP message objects and an in-memory socket.
async function get(app, path) {
  const chunks = [];
  const socket = new Duplex({
    read() {},
    write(chunk, encoding, done) {
      chunks.push(chunk);
      done();
    }
  });
  const req = new IncomingMessage(socket);
  req.url = path;
  req.method = 'GET';
  req.headers = { host: 'localhost' };
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  const res = new ServerResponse(req);
  res.assignSocket(socket);
  const finished = once(res, 'finish');
  app(req, res);
  await finished;
  socket.destroy();
  return [res.statusCode, JSON.parse(Buffer.concat(chunks).toString().split('\r\n\r\n')[1])];
}

test('Express handlers serve the documented endpoints and report upstream failures', async () => {
  const date = new Date('2026-11-27T18:00:00Z');
  const data = {
    locations: [{ id: 'sample', hours: { friday: [{ open: '08:00', close: '14:00' }] } }],
    temporarySchedules: [], nutrition: [{ url: freshDaily, items: [] }],
    sources: [{ url: freshDaily, status: 'fresh' }], stale: false, issues: []
  };
  const app = createApp({ getDiningData: async () => data, now: () => date });
  assert.deepEqual(await get(app, '/health'), [200, { status: 'ok' }]);
  const [status, listing] = await get(app, '/api/dining');
  assert.equal(status, 200);
  assert.equal(listing.locations[0].availability.open, true);
  assert.equal(listing.locations[0].availability.time, '12:00');
  assert.equal((await get(app, '/api/dining/sample'))[1].id, 'sample');
  assert.equal((await get(app, '/api/dining/coverage'))[1].locations[0].menuItems, 0);
  assert.equal((await get(app, '/api/dining/nutrition'))[1].documents[0].url, freshDaily);
  assert.equal((await get(app, '/api/dining/nutrition/fresh-plate'))[1].stale, false);
  assert.equal((await get(app, '/api/dining/unknown'))[0], 404);
  assert.equal((await get(app, '/unknown'))[0], 404);
  const down = createApp({ getDiningData: async () => { throw new Error('upstream down'); } });
  assert.equal((await get(down, '/api/dining'))[0], 502);
});
