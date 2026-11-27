import { nutrientFields } from '../nutrition.mjs';

export function coverage(data) {
  return data.locations.map(location => {
    const menu = location.menus?.flatMap(menu => menu.items) ?? [];
    const nutrition = data.nutrition
      .filter(document => location.nutritionSources?.some(source => source.url === document.url))
      .flatMap(document => document.items);
    const fields = Object.fromEntries(Object.keys(nutrientFields)
      .map(field => [field, nutrition.filter(item => item.nutrition[field] !== null).length]));
    return {
      id: location.id, name: location.name, building: location.building,
      description: Boolean(location.description), images: location.images?.length ?? 0,
      regularHours: Boolean(location.hours),
      temporaryDates: location.exceptions?.filter(record => record.kind === 'temporary').length ?? 0,
      holidayDates: location.exceptions?.filter(record => record.kind === 'holiday').length ?? 0,
      menuItems: menu.length, pricedItems: menu.filter(item => item.price !== null).length,
      rotationItems: menu.filter(item => item.rotation || item.days).length,
      mealRates: location.mealRates?.length ?? 0,
      matchedItems: menu.filter(item => item.nutritionMatches !== null).length,
      nutritionItems: nutrition.length, nutrients: fields,
      servingSize: nutrition.filter(item => item.servingSize !== null).length,
      menuAllergens: menu.filter(item => item.allergens !== null).length,
      nutritionAllergens: nutrition.filter(item => item.allergens !== null).length,
      ingredients: [...menu, ...nutrition].filter(item => item.ingredients !== null).length,
      dietary: [...menu, ...nutrition].filter(item => Object.values(item.dietary).some(value => value !== null)).length,
      externalLinks: location.externalLinks
    };
  });
}
