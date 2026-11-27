import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { refreshSnapshot, staleSnapshot } from './snapshot.mjs';
import { createUpstream } from './upstream.mjs';

export function createDiningService({
  beginRun = createUpstream(), ttlMs = 30 * 60 * 1000, retryMs = 60 * 1000,
  cacheFile = process.env.TTU_CACHE_FILE ?? '.cache/dining-v1.json', log = console
} = {}) {
  let cache;
  let refreshAfter = 0;
  let pending;

  async function loadCache() {
    if (!cacheFile) return {};
    try {
      const disk = JSON.parse(await readFile(cacheFile, 'utf8'));
      if (disk.version !== 1 || !disk.sources || typeof disk.sources !== 'object') throw new Error('Invalid cache format');
      return disk.sources;
    } catch (error) {
      if (error.code !== 'ENOENT') log.warn(error.message);
      return {};
    }
  }

  let previous;
  async function refresh() {
    previous ??= await loadCache();
    const snapshot = await refreshSnapshot(beginRun, previous);
    if (cacheFile) {
      try {
        const path = resolve(cacheFile);
        await mkdir(dirname(path), { recursive: true });
        const temp = `${path}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify({ version: snapshot.version, sources: snapshot.sources }), { flag: 'wx' });
        await rename(temp, path);
      } catch (error) {
        log.warn(`Cannot persist dining cache: ${error.message}`);
      }
    }
    previous = snapshot.sources;
    refreshAfter = Date.now() + (snapshot.data.stale ? retryMs : ttlMs);
    return snapshot.data;
  }

  return function getDiningData() {
    if (Date.now() < refreshAfter && cache) return Promise.resolve(cache);
    if (!pending) {
      pending = refresh().then(result => (cache = result)).catch(error => {
        log.error(error);
        refreshAfter = Date.now() + retryMs;
        if (cache) return (cache = { ...staleSnapshot(cache, error.message), checkedAt: new Date().toISOString() });
        throw error;
      }).finally(() => { pending = undefined; });
    }
    return pending;
  };
}
