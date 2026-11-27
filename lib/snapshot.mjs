import { collect } from './collect.mjs';

export async function refreshSnapshot(beginRun, previous = {}) {
  const next = { ...previous };
  const failures = [];
  const sources = new Map();
  const readPage = beginRun();
  async function read(url, parse, required = false) {
    try {
      const page = await readPage(url);
      const data = parse(page);
      next[url] = { retrievedAt: page.retrievedAt, data };
      sources.set(url, { url, retrievedAt: page.retrievedAt, status: 'fresh' });
      return data;
    } catch (error) {
      const retained = previous[url];
      const status = retained ? 'stale' : 'unavailable';
      failures.push({ url, status, message: error.message });
      sources.set(url, { url, status, retrievedAt: retained?.retrievedAt ?? null });
      if (retained) return retained.data;
      if (required) throw error;
      return null;
    }
  }

  const data = await collect(read);
  const updatedAt = sources.get(data.source).retrievedAt;
  return {
    version: 1,
    sources: Object.fromEntries([...sources.keys()].filter(url => next[url]).map(url => [url, next[url]])),
    data: { ...data, updatedAt, checkedAt: new Date().toISOString(),
      stale: failures.length > 0, sources: [...sources.values()], issues: failures }
  };
}

export function staleSnapshot(data, message) {
  const issues = data.issues.filter(issue => issue.url !== data.source || issue.message !== message);
  return { ...data, stale: true,
    issues: [...issues, { url: data.source, status: 'stale', message }],
    sources: data.sources.map(source => ({ ...source, status: source.retrievedAt ? 'stale' : 'unavailable' })) };
}
