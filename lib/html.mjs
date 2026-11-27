import { load } from 'cheerio';

export const ROOT = 'https://www.depts.ttu.edu/hospitality/';
export const DAYS = 'monday tuesday wednesday thursday friday saturday sunday'.split(' ');
export const clean = (value = '') => value.replace(/\s+/g, ' ').trim() || null;
export const slug = value => value.toLowerCase().replace(/[®™'’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const key = value => slug(value.normalize('NFKD').replace(/\p{M}/gu, '')).replace(/-/g, '');
export const sourceOf = ({ url, retrievedAt }) => ({ url, retrievedAt });

export function document(page) {
  const $ = load(page.html);
  requireStructure($('main').length === 1, 'missing TTU main content');
  return $;
}

export function requireStructure(condition, message) {
  if (!condition) throw new Error(`Unexpected TTU HTML: ${message}`);
}

export function links($, scope, base) {
  const entries = new Map();
  $(scope).find('a[href], iframe[src]').each((_, element) => {
    const el = $(element);
    const url = new URL(el.attr('href') ?? el.attr('src'), base);
    if (url.protocol !== 'https:' || url.username || url.password) return;
    if (!entries.has(url.href)) entries.set(url.href, { url: url.href, label: clean(el.text()) ?? el.attr('title') ?? null });
  });
  return [...entries.values()];
}

export function ttuPage(url, pattern) {
  const parsed = new URL(url);
  return parsed.origin === new URL(ROOT).origin && pattern.test(parsed.pathname);
}

export const locationPath = /^\/hospitality\/locations\/[^/]+\.php$/i;
export const menuPath = /^\/hospitality\/menu\/[^/]+\.php$/i;
export const nutritionPath = /^\/hospitality\/smartchoices\/nutrition-menu\/[^/]+\.php$/i;

export function cells($, row) {
  return $(row).children('th, td').map((_, cell) => clean($(cell).text()) ?? '').get();
}

export function textWithBreaks($, element) {
  const copy = $(element).clone();
  copy.find('br').replaceWith('\n');
  return copy.text().split('\n').map(clean).filter(Boolean);
}

export function headingFor($, element, selector) {
  const ordered = $(selector).add(element);
  return ordered.slice(0, ordered.index(element)).last();
}
