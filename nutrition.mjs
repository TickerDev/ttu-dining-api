import { cells, clean, document, key, requireStructure, sourceOf } from './lib/html.mjs';
import { blankDietary } from './lib/menu.mjs';

export const nutrientFields = {
  calories: ['calories', 'calorieskcal', 'energykcal'],
  fat: ['fatg', 'totalfatg'], carbs: ['carbsg', 'carbohydratesg', 'totalcarbohydrateg'],
  fiber: ['fiberg', 'fiber', 'dietaryfiberg'], protein: ['proteing'],
  sodium: ['sodiummg'], sugar: ['sugarg', 'sugarsg', 'totalsugarsg']
};

function number(value) {
  if (!value || /^(?:[-–—]+|n\/?a)$/i.test(value)) return null;
  const normalized = value.replace(/,/g, '');
  if (!/^\d*\.?\d+$/.test(normalized) || !Number.isFinite(Number(normalized))) return null;
  return Number(normalized);
}

function boolean(value) {
  if (/^(yes|true|✓|✔|x)$/i.test(value ?? '')) return true;
  if (/^(no|false)$/i.test(value ?? '')) return false;
  return null;
}

export function parseNutrition(page) {
  const $ = document(page);
  const title = clean($('main h1').first().text());
  const rotation = title?.match(/\bWeek \d+\b/i)?.[0] ?? null;
  const items = [];
  $('main table').each((_, table) => {
    const el = $(table);
    const headers = cells($, el.find('thead tr').first()).map(key);
    requireStructure(headers.includes('item') && nutrientFields.calories.some(field => headers.includes(field)),
      'nutrition item or calorie column missing');
    let category = null;
    el.find('tbody tr').each((_, row) => {
      const columns = $(row).children('td,th');
      const values = cells($, row);
      if (columns.length === 1 && Number(columns.attr('colspan')) === headers.length && values[0]) {
        category = values[0];
        return;
      }
      requireStructure(values.length === headers.length, `unexpected nutrition row width in ${title}`);
      const data = Object.fromEntries(headers.map((header, index) => [header, clean(values[index])]));
      requireStructure(data.item, `missing nutrition item in ${title}`);
      items.push({ id: String(items.length + 1), name: data.item, category, rotation,
        servingSize: data.servingsize ?? data.serving ?? null,
        nutrition: Object.fromEntries(Object.entries(nutrientFields).map(([field, aliases]) =>
          [field, number(data[aliases.find(alias => alias in data)])])),
        dietary: Object.fromEntries(Object.keys(blankDietary()).map(field => [field, boolean(data[key(field)])])),
        allergens: data.allergens ?? data.allergycontains ?? null,
        ingredients: data.ingredients ?? null, source: page.url });
    });
  });
  requireStructure(title && items.length && items.some(item => item.nutrition.calories !== null), 'no usable nutrition records');
  return { ...sourceOf(page), source: page.url, updatedAt: page.retrievedAt, title, count: items.length, items };
}

export function matchNutrition(menu, documents) {
  const byName = new Map();
  for (const document of documents) {
    for (const item of document.items) {
      const name = key(item.name);
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ url: document.url, itemId: item.id, rotation: item.rotation });
    }
  }
  return { ...menu, items: menu.items.map(item => {
    const candidates = (byName.get(key(item.name)) ?? []).filter(record =>
      !item.rotation || !record.rotation || key(item.rotation) === key(record.rotation));
    // Several published recipes for a name can carry different quantities.
    return { ...item, nutritionMatches: candidates.length ? candidates : null };
  }) };
}
