import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { createApp } from './lib/app.mjs';
import { getWorkerDiningData, refreshWorkerDiningData } from './lib/worker-store.mjs';

const app = createApp({ getDiningData: () => getWorkerDiningData(env.DINING_CACHE) });
const handler = httpServerHandler(createServer(app));

export default {
  fetch(request, bindings, ctx) {
    return handler.fetch(request, bindings, ctx);
  },
  async scheduled(controller, bindings) {
    const result = await refreshWorkerDiningData(bindings.DINING_CACHE);
    console.info({ event: 'dining_refresh', ...result });
  }
};
