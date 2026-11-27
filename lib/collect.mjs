import { ROOT, clean, document, key, links, locationPath, nutritionPath, requireStructure, sourceOf, ttuPage } from './html.mjs';
import { emptyLocation, identity, parseRegularHours, parseTemporaryHours } from '../scraper.mjs';
import { parseLocation, parseMenu } from './menu.mjs';
import { matchNutrition, parseNutrition } from '../nutrition.mjs';
import { timezone } from './availability.mjs';

const home = new URL('index.php', ROOT).href;
const weekly = new URL('dining_hours.php', ROOT).href;
const nutritionIndex = new URL('smartchoices/nutrition.php', ROOT).href;
// Existing public endpoint whose underlying URL is currently commented out in the TTU index.
export const freshDaily = new URL('smartchoices/Nutrition-Menu/TheFreshPlate-Daily-Nutrition.php', ROOT).href;
const temporaryPath = /\/hospitality\/dining-hours-(?:temporary|holiday|winter[^/]*|interim[^/]*)\.php$/i;

function directory(page) {
  const $ = document(page);
  const references = links($, 'html', page.url);
  const locations = references.filter(link => ttuPage(link.url, locationPath));
  requireStructure(locations.length, 'missing Hospitality location links');
  return { ...sourceOf(page), locations, temporary: references.filter(link => ttuPage(link.url, temporaryPath)) };
}

function nutritionDirectory(page) {
  const $ = document(page);
  const external = [];
  const documents = [];
  $('main h3').each((_, heading) => {
    const group = clean($(heading).clone().find('small').remove().end().text());
    links($, $(heading).parent(), page.url).forEach(link => {
      if (ttuPage(link.url, nutritionPath)) documents.push({ ...link, group });
      else if (group === 'National Brands') external.push({ ...link, group });
    });
  });
  const calculator = links($, 'main', page.url).find(({ url }) => new URL(url).hostname === 'restaurant.nutritionix.com');
  requireStructure(documents.length || calculator, 'missing nutrition directory');
  return { ...sourceOf(page), documents, external, calculator: calculator ?? null };
}

function bare(url) {
  const result = new URL(url);
  result.hash = '';
  return result.href;
}

export async function collect(read) {
  const [index, regular, nutritionIndexData] = await Promise.all([
    read(home, directory), read(weekly, parseRegularHours, true), read(nutritionIndex, nutritionDirectory)
  ]);
  const locations = regular.map(location => ({ ...location }));
  const exceptionUrls = [...new Set((index?.temporary ?? []).map(link => bare(link.url)))];
  const [exceptionsBySource, nutritionBySource] = await Promise.all([
    Promise.all(exceptionUrls.map(url => read(url, parseTemporaryHours))),
    Promise.all([...new Set([freshDaily, ...(nutritionIndexData?.documents ?? []).map(link => bare(link.url))])]
      .map(url => read(url, parseNutrition)))
  ]);
  const exceptions = exceptionsBySource.flatMap(result => result ?? []);
  const nutrition = nutritionBySource.filter(Boolean);
  const detailUrls = new Set([
    ...locations.map(location => location.page), ...(index?.locations ?? []).map(link => link.url),
    ...exceptions.flatMap(record => record.rows.map(row => row.url))
  ].filter(Boolean).map(bare));
  const details = (await Promise.all([...detailUrls].map(url => read(url, parseLocation)))).filter(Boolean);
  for (const detail of details) {
    const location = locations.find(row => row.anchor && row.anchor === detail.hoursAnchor) ??
      locations.find(row => detail.title && identity(row.name, row.building) === identity(detail.title, detail.building));
    if (location) {
      Object.assign(location, { page: detail.url, description: detail.description, images: detail.images,
        detailSource: sourceOf(detail), mealRates: detail.mealRates });
    } else if (detail.title) {
      locations.push({ ...emptyLocation(detail.title, detail.building), page: detail.url,
        description: detail.description, images: detail.images, detailSource: sourceOf(detail),
        mealRates: detail.mealRates });
    }
  }
  // A weekly information link can point to a different branch of the same restaurant.
  for (const location of locations) {
    const detail = details.find(row => row.url === location.page);
    if (!location.detailSource && detail) location.page = null;
  }
  const rawExceptions = new Map();
  for (const record of exceptions) {
    for (const row of record.rows) {
      const normalized = identity(row.name, row.building);
      const exact = locations.find(location => identity(location.name, location.building) === normalized);
      const linked = locations.find(location => row.url && location.page === row.url &&
        identity(location.name, null) === identity(row.name, null));
      let location = exact ?? linked;
      if (!location) {
        location = { ...emptyLocation(row.name, row.building), page: row.url };
        locations.push(location);
      }
      rawExceptions.set(row, location.id);
    }
  }
  const references = nutritionIndexData?.documents ?? [];
  // Use the TTU index's location group. Shared campus nutrition remains campus-scoped.
  const scope = document => {
    const ref = references.find(link => bare(link.url) === document.url);
    if (ref?.group && ref.group !== 'Campus Wide') return key(ref.group.replace(/^the /i, ''));
    return key(document.title.split(/\s+@\s+/)[0].replace(/^the /i, ''));
  };
  for (const document of nutrition) {
    const [name, building] = document.title.split(/\s+@\s+/);
    if (!building || locations.some(location => key(location.name.replace(/^the /i, '')) === scope(document))) continue;
    locations.push(emptyLocation(name, building.replace(/(?: Week \d+)? Nutrition$/i, '')));
  }

  const menuUrls = new Set(details.flatMap(detail => detail.menus.map(link => bare(link.url))));
  const menus = new Map(await Promise.all([...menuUrls].map(async url => [url, await read(url, parseMenu)])));
  requireStructure(new Set(locations.map(location => location.id)).size === locations.length, 'duplicate location IDs');
  for (const location of locations) {
    const name = key(location.name.replace(/^the /i, ''));
    const detail = details.find(row => row.url === location.page && location.detailSource);
    const ownNutrition = nutrition.filter(document => scope(document) === name);
    const brandLinks = (nutritionIndexData?.external ?? []).filter(link => key(link.label) === name);
    location.nutritionSources = ownNutrition.length ? ownNutrition.map(sourceOf) : null;
    location.menuLinks = detail?.menus.length ? detail.menus : null;
    const externalLinks = [...(detail?.externalLinks ?? []), ...brandLinks];
    location.externalLinks = externalLinks.length ? externalLinks : null;
    const ownMenus = (detail?.menus ?? []).map(link => menus.get(bare(link.url))).filter(Boolean);
    location.menus = ownMenus.length ? ownMenus.map(menu => matchNutrition(menu, ownNutrition)) : null;
    const overrides = exceptions.flatMap(({ rows, ...record }) => {
      const row = rows.find(row => rawExceptions.get(row) === location.id);
      if (!row && !record.allClosed) return [];
      return [{ ...record, hours: row?.hours ?? [] }];
    });
    location.exceptions = overrides.length ? overrides : null;
  }
  return {
    source: weekly, timezone, scheduleType: 'regular', count: locations.length, locations, nutrition,
    temporarySchedules: exceptions.map(({ rows, ...record }) => ({
      ...record, locations: rows.map(row => ({ id: rawExceptions.get(row), name: row.name, building: row.building, hours: row.hours }))
    })),
    nutritionix: nutritionIndexData?.calculator ?? null,
    nutritionIndexSource: nutritionIndexData ? sourceOf(nutritionIndexData) : null,
    exceptionsUnavailable: !index || !exceptionUrls.length || exceptionsBySource.some(result => !result)
  };
}
