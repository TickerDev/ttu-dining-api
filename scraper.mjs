import { cells, clean, DAYS, document, headingFor, key, links, locationPath,
  requireStructure, slug, sourceOf, textWithBreaks, ttuPage } from './lib/html.mjs';

export function normalizeTime(value, closing = false) {
  if (/^noon$/i.test(value)) return '12:00';
  if (/^midnight$/i.test(value)) return closing ? '24:00' : '00:00';
  const match = value.match(/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)$/i);
  requireStructure(match && Number(match[1]) >= 1 && Number(match[1]) <= 12, `invalid time ${value}`);
  const [, hour, minute = '00', period] = match;
  const hour24 = Number(hour) % 12 + (period.toLowerCase() === 'pm' ? 12 : 0);
  return `${String(hour24).padStart(2, '0')}:${minute}`;
}

export function emptyLocation(name, building) {
  return { id: slug([name, building].filter(Boolean).join('-')), name, building,
    description: null, images: null, page: null, detailSource: null, anchor: null, hours: null, hoursSource: null,
    hoursNotes: null, mealRates: null, exceptions: null, menus: null, nutritionSources: null };
}

export function parseRegularHours(page) {
  const $ = document(page);
  const locations = [];
  $('main .jquery-ui-accordion > h3').each((_, element) => {
    const heading = $(element);
    const container = heading.next('.table-container');
    const name = clean(heading.clone().find('sub').remove().end().text());
    const building = clean(heading.find('sub').text().replace(/^@\s*/, ''));
    const anchor = heading.attr('id');
    requireStructure(name && building && anchor && container.find('table').length, 'invalid weekly location panel');
    const location = emptyLocation(name, building);
    const hours = Object.fromEntries(DAYS.map(day => [day, []]));
    container.find('table').each((_, table) => {
      const [label, open, close] = cells($, $(table).find('thead tr').first());
      requireStructure(open?.toLowerCase() === 'open' && close?.toLowerCase() === 'close', `weekly headers for ${name}`);
      const seen = new Set();
      $(table).find('tbody tr').each((_, row) => {
        const [rawDay, opens, closes] = cells($, row);
        const day = rawDay?.toLowerCase();
        requireStructure(DAYS.includes(day) && !seen.has(day), `invalid or duplicate weekday for ${name}`);
        seen.add(day);
        if (/^closed$/i.test(opens)) return;
        requireStructure(opens && closes, `missing weekly time for ${name}`);
        hours[day].push({ type: label?.toLowerCase() || 'regular',
          open: normalizeTime(opens), close: normalizeTime(closes, true) });
      });
      requireStructure(seen.size === 7, `incomplete weekly hours for ${name}`);
    });
    const candidates = links($, container, page.url).filter(link => ttuPage(link.url, locationPath));
    const notes = container.clone();
    notes.find('.table-wrapper, table, a').remove();
    locations.push({ ...location, anchor, hours, hoursSource: sourceOf(page), hoursNotes: clean(notes.text()),
      page: candidates[0]?.url ?? null });
  });
  requireStructure(locations.length && new Set(locations.map(row => row.id)).size === locations.length,
    'missing or duplicate weekly locations');
  return locations;
}

const months = 'january february march april may june july august september october november december'.split(' ');
function dateRange(text, year) {
  const expression = new RegExp(`^(${months.join('|')}) (\\d{1,2})(?:st|nd|rd|th)?(?:\\s*(–|-|&)\\s*(?:(${months.join('|')}) )?(\\d{1,2})(?:st|nd|rd|th)?)?$`, 'i');
  const match = text.match(expression);
  requireStructure(match, `invalid dated heading ${text}`);
  const [, first, start, separator, last = first, end = start] = match;
  function date(month, day, fullYear) {
    const index = months.indexOf(month.toLowerCase());
    const result = new Date(Date.UTC(fullYear, index, Number(day)));
    requireStructure(result.getUTCMonth() === index, `invalid calendar day ${text}`);
    return result;
  }
  const from = date(first, start, year);
  const until = date(last, end, year + Number(months.indexOf(last.toLowerCase()) < from.getUTCMonth()));
  requireStructure(until >= from && until - from < 45 * 86400000, `invalid date range ${text}`);
  const dates = [];
  for (const day = new Date(from); day <= until; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
    if (separator === '&' && day < until) day.setTime(until.getTime() - 86400000);
  }
  return dates;
}

export function parseTemporaryHours(page) {
  const $ = document(page);
  const exceptions = [];
  const dated = $('main .jquery-ui-accordion h3');
  requireStructure(dated.length, 'missing dated headings');
  dated.each((_, heading) => {
    const title = clean(headingFor($, heading, 'main .jquery-ui-accordion h2').text());
    const year = Number(title?.match(/\b20\d{2}\b/)?.[0]);
    const [label, date, ...rest] = textWithBreaks($, heading);
    requireStructure(year && date && !rest.length && (label.toLowerCase() === 'closed' || DAYS.includes(label.toLowerCase())),
      `missing dated schedule context for ${$(heading).text()}`);
    const dates = dateRange(date, year);
    if (label.toLowerCase() !== 'closed') {
      requireStructure(dates.length === 1 && DAYS[(new Date(dates[0]).getUTCDay() + 6) % 7] === label.toLowerCase(),
        `weekday/date mismatch: ${label} ${date}`);
    }
    const panel = $(heading).next();
    const text = clean(panel.text());
    const allClosed = label.toLowerCase() === 'closed' && /all locations will be closed/i.test(text);
    const rows = [];
    if (!allClosed) {
      const table = panel.find('table');
      requireStructure(table.length === 1 && cells($, table.find('thead tr').first()).join('|').toLowerCase() === 'location|hours',
        `missing dated location table for ${date}`);
      table.find('tbody tr').each((_, row) => {
        const [place, period] = $(row).children('td').toArray();
        const building = clean($(place).find('small').text().replace(/^@\s*/, ''));
        const name = clean($(place).clone().find('small').remove().end().text());
        requireStructure(name && period, `missing dated location or hours for ${date}`);
        const periods = textWithBreaks($, period);
        const hours = [];
        let type = 'regular';
        for (const entry of periods) {
          if (/^closed$/i.test(entry)) continue;
          const range = entry.match(/^(.+?)\s*[-–—]\s*(.+)$/);
          if (!range) {
            type = entry.toLowerCase();
            continue;
          }
          hours.push({ type, open: normalizeTime(range[1]), close: normalizeTime(range[2], true) });
          type = 'regular';
        }
        requireStructure(hours.length || periods.some(entry => /^closed$/i.test(entry)), `missing dated hours for ${name}`);
        const url = links($, place, page.url).find(link => ttuPage(link.url, locationPath))?.url ?? null;
        rows.push({ name, building, url, hours });
      });
      requireStructure(rows.length, `empty dated schedule for ${date}`);
    }
    for (const day of dates) exceptions.push({ date: day, title,
      kind: /thanksgiving|holiday|christmas|labor day|memorial day|independence day/i.test(title) ? 'holiday' : 'temporary',
      allClosed, notice: allClosed ? text : null, source: sourceOf(page), rows });
  });
  requireStructure(new Set(exceptions.map(record => record.date)).size === exceptions.length, 'duplicate exception dates');
  return exceptions;
}

export function identity(name, building) {
  return [key(name.replace(/^the /i, '')).replace(/^23sneed$/, '23atsneed')
      .replace(/^einsteinsbros/, 'einsteinbros').replace(/^campchickfila$/, 'chickfila'),
    key((building ?? '').replace(/^the /i, '').replace(/ hall$/i, ''))].join(':');
}
