import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { availability } from '../lib/availability.mjs';
import { freshDaily } from '../lib/collect.mjs';
import { ROOT } from '../lib/html.mjs';
import { parseLocation, parseMenu } from '../lib/menu.mjs';
import { getWorkerDiningData, refreshWorkerDiningData } from '../lib/worker-store.mjs';
import { createDiningService } from '../lib/service.mjs';
import { createUpstream, parseRobots } from '../lib/upstream.mjs';
import { matchNutrition, parseNutrition } from '../nutrition.mjs';
import { identity, parseRegularHours, parseTemporaryHours } from '../scraper.mjs';

const retrievedAt = '2026-11-27T12:00:00.000Z';
const url = path => new URL(path, ROOT).href;
const fixture = name => readFileSync(new URL(`fixtures/${name}.html`, import.meta.url), 'utf8');
const page = (name, path) => ({ url: url(path), html: fixture(name), retrievedAt });

test('weekly panel keeps building, weekdays, intervals and source', () => {
  const [sneed] = parseRegularHours(page('weekly', 'dining_hours.php'));
  assert.equal(sneed.id, '23-at-sneed-sneed-hall');
  assert.equal(sneed.page, url('locations/23atsneed.php'));
  assert.deepEqual(sneed.hours.monday, [{ type: 'regular', open: '07:00', close: '21:00' }]);
  assert.equal(sneed.hoursSource.retrievedAt, retrievedAt);
  const broken = page('weekly', 'dining_hours.php');
  broken.html = broken.html.replace('Monday', 'Unknown');
  assert.throws(() => parseRegularHours(broken), /Unexpected TTU HTML/);
});

test('temporary schedule expands holiday closures and preserves meal windows', () => {
  const records = parseTemporaryHours(page('temporary', 'Dining-Hours-Temporary.php'));
  assert.deepEqual(records.filter(record => record.allClosed).map(record => record.date),
    ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
  const plate = records[0].rows.find(row => row.name === 'Fresh Plate');
  assert.deepEqual(plate.hours.map(interval => interval.type), ['breakfast', 'lunch', 'dinner']);
  assert.equal(identity("Einstein's Bros.® Bagels", 'Talkington Hall'), identity('Einstein Bros® Bagels', 'Talkington'));
  assert.equal(identity('The Burkhart Café', 'Burkhart Center'), identity('Burkhart Cafe', 'Burkhart Center'));
});

test('location and menu parse meal rates, image, price absence and rotation', () => {
  const location = parseLocation(page('location', 'locations/freshplate.php'));
  assert.equal(location.title, 'The Fresh Plate');
  assert.equal(location.hoursAnchor, 'FreshPlate');
  assert.equal(location.menus[0].url, url('Menu/FreshPlate-Menu.php'));
  assert.match(location.images[0], /FreshPlate/);
  assert.ok(location.mealRates.length);
  const menu = parseMenu(page('menu', 'Menu/FreshPlate-Menu.php'));
  const item = menu.items.find(item => item.name === 'Chicken Strips');
  assert.deepEqual(item.days, ['monday']);
  assert.equal(item.rotation, 'Week 1');
  assert.equal(item.priceCents, null);
  const burger = menu.items.find(item => item.name.includes('Black Bean Burger'));
  assert.equal(burger.dietary.vegan, true);
  assert.equal(burger.dietary.vegetarian, null);
});

test('nutrition keeps unknown fields null and matches compatible item names and weeks', () => {
  const data = parseNutrition(page('nutrition', 'smartchoices/Nutrition-Menu/Week1.php'));
  const eggs = data.items.find(item => item.name === 'Scrambled Eggs');
  assert.ok(eggs.nutrition.calories > 0);
  assert.equal(eggs.nutrition.sodium, null);
  assert.equal(eggs.nutrition.sugar, null);
  assert.equal(eggs.ingredients, null);
  const items = matchNutrition({ items: [
    { name: 'SCRAMBLED EGGS', rotation: 'Week 1' },
    { name: 'Scrambled Eggs', rotation: 'Week 2' },
    { name: 'Eggs' }
  ] }, [data]).items;
  assert.deepEqual(items[0].nutritionMatches, [{ url: data.url, itemId: eggs.id, rotation: 'Week 1' }]);
  assert.equal(items[1].nutritionMatches, null);
  assert.equal(items[2].nutritionMatches, null);
});

test('Chicago availability handles DST, boundaries, overnight and dated overrides', () => {
  const location = { hours: { monday: [{ open: '20:00', close: '02:00' }], tuesday: [] } };
  assert.equal(availability(location, new Date('2026-07-07T06:59:00Z')).open, true);
  assert.equal(availability(location, new Date('2026-07-07T07:00:00Z')).open, false);
  assert.equal(availability(location, new Date('2026-01-06T07:59:00Z')).open, true);
  assert.equal(availability(location, new Date('2026-07-07T06:59:00Z'), false, new Set(['2026-07-07'])).open, null);
  location.exceptions = [{ date: '2026-07-07', kind: 'holiday', hours: [] }];
  assert.equal(availability(location, new Date('2026-07-07T06:59:00Z')).open, false);
});

test('upstream requests are deduplicated and respect robots, redirects and backoff', async () => {
  const allows = parseRobots('User-agent: *\nDisallow: /hospitality/*\nAllow: /hospitality/index.php$');
  assert.equal(allows('/hospitality/index.php'), true);
  assert.equal(allows('/hospitality/index.php/other'), false);
  const calls = [];
  const get = createUpstream({ spacingMs: 0, fetcher: async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    if (url.endsWith('robots.txt')) return new Response('User-agent: *\nDisallow: /hospitality/blocked.php');
    if (url.endsWith('redirect.php')) return new Response(null, { status: 302 });
    return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
  } })();
  assert.equal(get(url('redirect.php')), get(url('redirect.php#anchor')));
  await assert.rejects(get(url('blocked.php')), /Disallowed/);
  await assert.rejects(get(url('redirect.php')), /302/);
  await assert.rejects(get(url('index.php')), /429/);
  await assert.rejects(get(url('after.php')), /retry delay/);
  assert.throws(() => get('https://example.com/index.php'), /outside allowed/);
  assert.equal(calls.length, 3);
});

test('refresh coalesces calls and retains validated data after errors and restarts', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ttu-api-'));
  try {
    const cacheFile = join(folder, 'cache.json');
    const pages = {
      'index.php': '<main><a href="locations/freshplate.php">Fresh Plate</a><a href="Dining-Hours-Temporary.php">Temporary</a></main>',
      'dining_hours.php': fixture('weekly'),
      'Dining-Hours-Temporary.php': fixture('temporary'),
      'smartchoices/nutrition.php': fixture('nutrition-index'),
      'locations/freshplate.php': fixture('location'),
      'Menu/FreshPlate-Menu.php': fixture('menu')
    };
    let runs = 0;
    let failing = false;
    const options = {
      ttlMs: 0, retryMs: 30000, cacheFile,
      beginRun: () => {
        runs++;
        return async url => {
          const path = url.slice(ROOT.length);
          if (failing && path === 'dining_hours.php') return { html: '<main>Changed</main>', url, retrievedAt };
          const html = pages[path] ?? (url === freshDaily || /nutrition-menu/i.test(path) ? fixture('nutrition') : null);
          if (!html) throw new Error('fixture missing');
          return { url, html, retrievedAt };
        };
      }
    };
    const service = createDiningService(options);
    const [first, same] = await Promise.all([service(), service()]);
    assert.equal(first, same);
    assert.equal(runs, 1);
    assert.equal(first.nutrition.length, 6);
    assert.ok(first.nutritionix.url.includes('nutritionix.com'));
    failing = true;
    const second = await createDiningService(options)();
    assert.equal(second.updatedAt, retrievedAt);
    assert.ok(second.locations.some(location => location.hours));
    assert.equal(second.sources.find(source => source.url.endsWith('dining_hours.php')).status, 'stale');
    let stored;
    const kv = {
      async get() { return stored ? JSON.parse(stored) : null; },
      async put(key, value) { assert.equal(key, 'dining-v1'); stored = value; }
    };
    await assert.rejects(getWorkerDiningData(kv), /snapshot is unavailable/);
    failing = false;
    await refreshWorkerDiningData(kv, options.beginRun);
    const workerData = await getWorkerDiningData(kv);
    assert.equal(workerData.nutrition.length, 6);
    failing = true;
    await refreshWorkerDiningData(kv, options.beginRun);
    const retained = await getWorkerDiningData(kv);
    assert.equal(retained.updatedAt, retrievedAt);
    assert.ok(retained.stale);
    const overdue = await getWorkerDiningData(kv, Date.parse(retained.checkedAt) + 66 * 60 * 1000);
    assert.match(overdue.issues.at(-1).message, /overdue/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
