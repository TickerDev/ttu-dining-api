import { pathToFileURL } from 'node:url';
import { createApp as createExpressApp } from './lib/app.mjs';
import { createDiningService } from './lib/service.mjs';

export function createApp({ getDiningData = createDiningService(), now } = {}) {
  return createExpressApp({ getDiningData, now });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  createApp().listen(port, process.env.HOST ?? '0.0.0.0', () => {
    console.log(`TTU Dining API listening on port ${port}`);
  });
}
