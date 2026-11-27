import { DAYS } from './html.mjs';

export const timezone = 'America/Chicago';
const format = new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

export function availability(location, now = new Date(), exceptionsUnavailable = false, affectedDates = new Set()) {
  const parts = Object.fromEntries(format.formatToParts(now).map(({ type, value }) => [type, value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const yesterday = new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10);
  const weekday = parts.weekday.toLowerCase();
  const time = `${parts.hour}:${parts.minute}`;
  function schedule(day, weekday) {
    const exception = location.exceptions?.find(record => record.date === day);
    return exception ? { basis: exception.kind, hours: exception.hours } :
      { basis: 'regular', hours: exceptionsUnavailable || affectedDates.has(day) ? null : location.hours?.[weekday] ?? null };
  }
  const today = schedule(date, weekday);
  const previous = schedule(yesterday, DAYS[(DAYS.indexOf(weekday) + 6) % 7]);
  const openToday = today.hours?.some(interval => interval.open <= time &&
    (interval.close < interval.open || time < interval.close));
  const openOvernight = !affectedDates.has(date) && !location.exceptions?.some(record => record.date === date) &&
    previous.hours?.some(interval => interval.close < interval.open && time < interval.close);
  const open = openToday || openOvernight ? true : today.hours === null ? null : false;
  return { open, basis: openOvernight ? previous.basis : today.hours === null ? null : today.basis,
    date, time, timezone, asOf: now.toISOString() };
}
