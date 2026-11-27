import { setTimeout as delay } from 'node:timers/promises';
import { ROOT } from './html.mjs';

const origin = new URL(ROOT).origin;
const agent = 'TTUDiningAPI';
const maxBytes = 4 * 1024 * 1024;

export function parseRobots(text, product = agent) {
  const groups = [];
  let group;
  for (const line of text.split(/\r?\n/)) {
    const match = line.replace(/#.*/, '').match(/^\s*([\w-]+):\s*(.*?)\s*$/);
    if (!match) continue;
    const [, rawName, value] = match;
    const name = rawName.toLowerCase();
    if (name === 'user-agent') {
      if (!group || group.rules.length) groups.push(group = { agents: [], rules: [] });
      group.agents.push(value.toLowerCase());
    } else if (group && ['allow', 'disallow'].includes(name)) {
      group.rules.push({ name, value });
    }
  }
  const specific = groups.filter(group => group.agents.includes(product.toLowerCase()));
  const rules = (specific.length ? specific : groups.filter(group => group.agents.includes('*')))
    .flatMap(group => group.rules).filter(rule => rule.value.startsWith('/'));
  return path => {
    const matches = rules.filter(({ value }) => {
      const anchored = value.endsWith('$');
      const pattern = (anchored ? value.slice(0, -1) : value).split('*')
        .map(part => part.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&')).join('.*');
      return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
    });
    matches.sort((a, b) => b.value.length - a.value.length || Number(b.name === 'allow') - Number(a.name === 'allow'));
    return matches[0]?.name !== 'disallow';
  };
}

export function createUpstream({ fetcher = fetch, spacingMs = 500, timeoutMs = 10000 } = {}) {
  let queue = Promise.resolve();
  let blockedUntil = 0;

  function request(url, robots = false) {
    const job = queue.then(async () => {
      if (Date.now() < blockedUntil) throw new Error('TTU requested a retry delay');
      const response = await fetcher(url, {
        headers: { 'user-agent': agent, accept: robots ? 'text/plain' : 'text/html' },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.status === 429 || response.status === 503) {
        const retry = response.headers.get('retry-after');
        const milliseconds = /^\d+$/.test(retry ?? '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
        blockedUntil = Date.now() + Math.max(60000, milliseconds || 0);
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (robots && [404, 410].includes(response.status)) return '';
        throw new Error(`HTTP ${response.status}`);
      }
      if (!robots && !/^text\/html\b/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel();
        throw new Error('Expected HTML');
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw new Error('TTU response exceeded size limit');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      if (robots && /^\s*</.test(body)) throw new Error('Expected robots.txt');
      return body;
    });
    queue = job.catch(() => {}).then(() => delay(spacingMs));
    return job;
  }

  return function beginRun() {
    const rules = request(`${origin}/robots.txt`, true).then(body => parseRobots(body));
    const requests = new Map();
    return input => {
      const url = new URL(input);
      if (url.origin !== origin || url.username || url.password || url.search ||
          !/^\/hospitality\/[-\w/]+\.php$/i.test(url.pathname)) {
        throw new Error(`URL outside allowed TTU HTML sources: ${url.href}`);
      }
      url.hash = '';
      if (!requests.has(url.href)) {
        requests.set(url.href, rules.then(async allowed => {
          if (!allowed(url.pathname)) throw new Error('Disallowed by robots.txt');
          return { url: url.href, html: await request(url.href), retrievedAt: new Date().toISOString() };
        }));
      }
      return requests.get(url.href);
    };
  };
}
