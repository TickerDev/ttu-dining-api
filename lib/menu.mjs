import { cells, clean, DAYS, document, headingFor, key, links, menuPath, requireStructure,
  sourceOf, textWithBreaks, ttuPage } from './html.mjs';

const dietaryPatterns = { vegan: /\bvegan\b/i, vegetarian: /\bvegetarian\b/i,
  glutenFree: /\bgluten[- ]free\b/i, halal: /\bhalal\b/i, kosher: /\bkosher\b/i };
export const blankDietary = () => Object.fromEntries(Object.keys(dietaryPatterns).map(name => [name, null]));

export function parseMenu(page) {
  const $ = document(page);
  const items = [];
  $('main table').each((_, table) => {
    const el = $(table);
    const [category, ...headers] = cells($, el.find('thead tr').first());
    const columns = headers.map(key);
    requireStructure(category && columns.some(column => /^(price|allergen)/.test(column)), 'unrecognized menu headers');
    const section = clean(headingFor($, table, 'main h2').text());
    const caption = clean(el.children('caption').text());
    const wrapper = el.closest('.table-wrapper');
    const following = wrapper.nextAll(':not(br)').first();
    const availabilityText = following.is('p') ?
      textWithBreaks($, following).find(line => /^available:/i.test(line)) ?? null : null;
    const initialCount = items.length;
    el.find('tbody tr').each((_, row) => {
      const [nameCell] = $(row).children('td,th').toArray();
      const [name, ...details] = textWithBreaks($, nameCell);
      const [, ...values] = cells($, row);
      const recovered = values.length === 1 && columns.length === 2 && columns[0] === 'price' &&
        columns[1].startsWith('allergen') && values[0] && /^[\p{L} ,/-]+$/u.test(values[0]);
      if (recovered) values.unshift('');
      if (values.length < columns.length && values.every((_, index) =>
        key($(row).children().eq(index + 1).attr('data-th') ?? '') === columns[index])) {
        while (values.length < columns.length) values.push('');
      }
      if (!name && values.every(value => !value)) return;
      requireStructure(name && columns.length === values.length, `menu row width in ${category}: ${name}`);
      const data = Object.fromEntries(columns.map((column, index) => [column, clean(values[index])]));
      const rawAllergens = data[columns.find(column => column.startsWith('allergen'))] ?? null;
      const dietary = Object.fromEntries(Object.entries(dietaryPatterns)
        .map(([field, pattern]) => [field, pattern.test(rawAllergens) ? true : null]));
      const dayText = data.day || availabilityText || (/\bmenu$/i.test(section) || /^Breakfast Served Daily/i.test(section) ? section : '');
      const days = /monday\s*[-–]\s*friday/i.test(dayText) ? DAYS.slice(0, 5) :
        DAYS.filter(day => new RegExp(`\\b${day}\\b`, 'i').test(dayText));
      const price = data.price ?? null;
      const exactPrice = price?.match(/^\$(\d+)\.(\d{2})(?:\s+(per .+))?$/i);
      const cents = exactPrice ? Number(exactPrice[1]) * 100 + Number(exactPrice[2]) : null;
      items.push({ id: String(items.length + 1), name, category, section, caption,
        description: data.description ?? clean(details.join(' ')), price,
        priceCents: Number.isSafeInteger(cents) ? cents : null, priceUnit: exactPrice?.[3] ?? null,
        days: days.length ? days : null, rotation: data.week ?? null, availabilityText,
        allergens: rawAllergens, dietary, ingredients: data.ingredients ?? null, nutritionMatches: null });
    });
    requireStructure(items.length > initialCount, `empty menu table ${category}`);
  });
  requireStructure(items.length, 'no menu items');
  return { ...sourceOf(page), title: clean($('main h1').first().text()) ?? $('main h1 img').first().attr('alt') ?? null, items };
}

export function parseLocation(page) {
  const $ = document(page);
  const heading = $('main h1, main h2').first();
  requireStructure(heading.length, 'missing location heading');
  const content = heading.parent();
  const nameHeading = heading.clone();
  nameHeading.find('sup').filter((_, el) => /^\s*-/.test($(el).text())).remove();
  const title = textWithBreaks($, nameHeading).find(Boolean) ?? null;
  const building = clean(heading.find('sup').map((_, el) => $(el).text()).get()
    .find(value => /^\s*-/.test(value))?.replace(/^\s*-\s*|\s*-\s*$/g, ''));
  const description = content.children('p').map((_, p) => {
    const text = clean($(p).text());
    return text?.length > 35 && !/^(visit |\*|location\s*dining hours)/i.test(text) ? text : null;
  }).get().join('\n\n') || null;
  const images = [...new Set(content.find('img[src]').map((_, img) => {
    const url = new URL($(img).attr('src'), page.url);
    return url.protocol === 'https:' ? url.href : null;
  }).get())];
  const references = links($, content, page.url);
  const menus = references.filter(link => ttuPage(link.url, menuPath));
  const externalLinks = references.filter(({ url, label }) =>
    /\b(menu|nutrition|allergen)\b/i.test(label ?? '') && !ttuPage(url, menuPath));
  const mealRates = [];
  content.find('table').each((_, table) => {
    const [, meal, guest] = cells($, $(table).find('thead tr').first());
    if (!/^Meal Value/i.test(meal ?? '') || !/^Guest Rate/i.test(guest ?? '')) return;
    $(table).find('tbody tr').each((_, row) => {
      const [service, diningBucks, guestRate] = cells($, row);
      if (service && diningBucks && guestRate) mealRates.push({ service, diningBucks, guestRate });
    });
  });
  return { ...sourceOf(page), title, building, description, images: images.length ? images : null,
    menus, externalLinks, mealRates: mealRates.length ? mealRates : null,
    hoursAnchor: references.find(link => /\/dining_hours\.php#/i.test(link.url))?.url.split('#')[1] ?? null };
}
