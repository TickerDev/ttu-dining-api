import express from 'express';
import cors from 'cors';
import { availability } from './availability.mjs';
import { freshDaily } from './collect.mjs';
import { coverage } from './coverage.mjs';

export function createApp({ getDiningData, now = () => new Date() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  function route(path, send) {
    app.get(path, async (req, res, next) => {
      let data;
      try {
        data = await getDiningData();
      } catch {
        return res.status(502).json({ error: 'Unable to retrieve TTU dining information' });
      }
      try {
        return send(req, res, data);
      } catch (error) {
        return next(error);
      }
    });
  }

  function current(location, data, instant) {
    return { ...location, availability: availability(location, instant, data.exceptionsUnavailable, new Set(data.temporarySchedules.map(schedule => schedule.date))) };
  }

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  route('/api/dining', (req, res, data) => {
    const instant = now();
    const { nutrition, ...summary } = data;
    res.json({ ...summary, locations: data.locations.map(location => current(location, data, instant)) });
  });
  route('/api/dining/coverage', (req, res, data) => {
    res.json({ checkedAt: data.checkedAt, stale: data.stale, issues: data.issues, locations: coverage(data) });
  });
  route('/api/dining/nutrition', (req, res, data) => {
    res.json({ checkedAt: data.checkedAt, stale: data.stale, nutritionix: data.nutritionix, documents: data.nutrition });
  });
  route('/api/dining/nutrition/fresh-plate', (req, res, data) => {
    const document = data.nutrition.find(record => record.url === freshDaily);
    if (!document) return res.status(502).json({ error: 'Unable to retrieve Fresh Plate nutrition information' });
    res.json({ ...document, stale: data.sources.find(source => source.url === freshDaily)?.status === 'stale' });
  });
  route('/api/dining/:id', (req, res, data) => {
    const location = data.locations.find(location => location.id === req.params.id);
    if (!location) return res.status(404).json({ error: 'Dining location not found' });
    res.json({ ...current(location, data, now()), stale: data.stale });
  });
  app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  return app;
}

