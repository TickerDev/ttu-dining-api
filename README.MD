# TTU Dining API

An independent, unofficial Node.js API for the data Texas Tech Hospitality Services publishes. The service can be deployed from this directory alone on Cloudflare Workers or a standalone Node.js host.

## Deploy to Cloudflare Workers

From this directory, use Node.js 22 or newer and an authenticated Cloudflare account on the Workers Paid plan. The complete Cheerio collection uses more CPU than the Free plan's scheduled invocation budget is designed for.

```text
npm ci
npm test
npx wrangler deploy --dry-run
npx wrangler deploy
```

[wrangler.jsonc](wrangler.jsonc) defines the Worker, the `DINING_CACHE` KV binding, and a 30-minute Cron Trigger. Wrangler provisions the namespace on first deployment if the binding has no ID. Keep one scheduled collector per namespace.

The Cron Trigger collects the data and stores the validated snapshot in KV. API requests read KV and compute availability at request time. A failed source keeps its previous validated data, and a missed refresh leaves the snapshot available with a stale flag once it is more than 65 minutes old. Until the first successful collection reaches KV, the dining endpoints return `502` and `/health` continues to report process liveness. Worker logs record the source issues for each completed refresh.

## Run on Node.js

Use Node.js 22 or newer. From this directory:

```text
npm ci
npm test
npm run collect
npm run coverage
npm start
```

The collection commands write JSON to stdout and finish without opening a listening socket. The server defaults to `0.0.0.0:3001`. Set `HOST` and `PORT` to override these defaults. Deploy with `npm ci --omit=dev` and `npm start`. Keep the default `.cache/` directory on persistent storage or set `TTU_CACHE_FILE` to a writable path on a persistent volume. Use one collector instance per deployment to keep cache and upstream pacing coordinated.

The collector checks TTU's robots.txt and reads public HTML over HTTPS. It normalizes and deduplicates URLs within a refresh and issues one request at a time with a 500 ms pause after each response. Individual requests time out after 10 seconds. HTTP 429 and 503 trigger a pause that honors `Retry-After` with a minimum of one minute. Redirects and non-HTML pages surface as source issues.

Results are cached for 30 minutes and refresh on demand. Concurrent API requests share the refresh. Each failed source retains its last validated data and its original retrieval timestamp. The collector retries on the next request after a one-minute cooldown. The service atomically writes parsed source data to disk to retain it across restarts. A first collection can take tens of seconds. Run `npm run collect` before opening traffic to initialize the disk cache and check source issues. Both CLI commands exit with status 1 when any source is stale or unavailable.

## Endpoints

All responses are JSON. The API returns `404` with `{ error: string }` for an unknown location ID or route. A required dataset that has never been collected returns `502` with the same error shape. These endpoints are read-only.

| GET | Successful response |
| --- | --- |
| `/health` | `{ status: "ok" }`. Process liveness independent of upstream status. |
| `/api/dining` | `DiningDataset` with embedded menus and schedule exceptions. |
| `/api/dining/:id` | `Location & { stale: boolean }`. Obtain IDs from the list. |
| `/api/dining/coverage` | `{ checkedAt: Timestamp, stale: boolean, issues: Issue[], locations: Coverage[] }`. See the [live-run coverage report](COVERAGE.md). |
| `/api/dining/nutrition` | `{ checkedAt: Timestamp, stale: boolean, nutritionix: Link \| null, documents: NutritionDocument[] }`. Resolves menu nutrition references by document URL and item ID. |
| `/api/dining/nutrition/fresh-plate` | `NutritionDocument & { stale: boolean }` for Fresh Plate's daily nutrition table. The nutrition collection also includes the separate weekly publications. |

### Schema

`Timestamp` is UTC ISO 8601. `Date` is a Chicago calendar day in `YYYY-MM-DD` format. `Time` is a Chicago wall clock in 24-hour `HH:MM` format. `24:00` indicates end-of-day midnight. When closing time is earlier than opening time, the interval extends into the following day. The fields below are present unless marked optional.

```ts
type Source = { url: string; retrievedAt: Timestamp }
type Link = { url: string; label: string | null }
type SourceStatus = "fresh" | "stale" | "unavailable"
type Issue = { url: string; status: "stale" | "unavailable"; message: string }
type Interval = { type: string; open: Time; close: Time }
type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday"
type Exception = {
  date: Date; title: string; kind: "holiday" | "temporary"
  allClosed: boolean; notice: string | null; source: Source
}
type Availability = {
  open: boolean | null
  basis: "regular" | "temporary" | "holiday" | null
  date: Date; time: Time; timezone: "America/Chicago"; asOf: Timestamp
}
type DiningDataset = {
  source: string; timezone: "America/Chicago"; scheduleType: "regular"
  updatedAt: Timestamp; checkedAt: Timestamp; count: number; stale: boolean
  locations: Location[]
  temporarySchedules: (Exception & {
    locations: { id: string; name: string; building: string | null; hours: Interval[] }[]
  })[]
  nutritionix: Link | null; nutritionIndexSource: Source | null
  exceptionsUnavailable: boolean
  sources: { url: string; retrievedAt: Timestamp | null; status: SourceStatus }[]
  issues: Issue[]
}
type Location = {
  id: string; name: string; building: string | null; anchor: string | null
  description: string | null; images: string[] | null; page: string | null
  detailSource: Source | null
  hours: Record<Weekday, Interval[]> | null; hoursSource: Source | null
  hoursNotes: string | null
  mealRates: { service: string; diningBucks: string; guestRate: string }[] | null
  exceptions: (Exception & { hours: Interval[] })[] | null
  menus: Menu[] | null; menuLinks: Link[] | null; externalLinks: Link[] | null
  nutritionSources: Source[] | null; availability: Availability
}
type Dietary = {
  vegan: boolean | null; vegetarian: boolean | null; glutenFree: boolean | null
  halal: boolean | null; kosher: boolean | null
}
type Menu = Source & { title: string | null; items: MenuItem[] }
type MenuItem = {
  id: string; name: string; category: string; section: string | null; caption: string | null
  description: string | null; price: string | null; priceCents: number | null
  priceUnit: string | null; days: Weekday[] | null; rotation: string | null
  availabilityText: string | null
  allergens: string | null; dietary: Dietary; ingredients: string | null
  nutritionMatches: { url: string; itemId: string; rotation: string | null }[] | null
}
type Nutrient = "calories" | "fat" | "carbs" | "fiber" | "protein" | "sodium" | "sugar"
type NutritionDocument = Source & {
  source: string; updatedAt: Timestamp; title: string; count: number; items: NutritionItem[]
}
type NutritionItem = {
  id: string; name: string; category: string | null; rotation: string | null
  servingSize: string | null; nutrition: Record<Nutrient, number | null>
  dietary: Dietary; allergens: string | null; ingredients: string | null; source: string
}
type Coverage = {
  id: string; name: string; building: string | null
  description: boolean; images: number; regularHours: boolean
  temporaryDates: number; holidayDates: number
  menuItems: number; pricedItems: number; rotationItems: number; mealRates: number
  matchedItems: number; nutritionItems: number; nutrients: Record<Nutrient, number>
  servingSize: number; menuAllergens: number; nutritionAllergens: number
  ingredients: number; dietary: number; externalLinks: Link[] | null
}
```

`updatedAt` in the dining dataset is the weekly source's retrieval time. `checkedAt` marks the refresh attempt. `stale` on the dataset and location endpoints indicates a source issue anywhere in the dataset. See `sources` for individual source status. Serving size is the published text. Calories are kcal, sodium is mg, and other nutrients are grams. Menu prices preserve the source text. Exact USD prices also have integer cents, with a separate unit when TTU gives one. Variant or ambiguous prices retain their original text. A null value indicates unavailable or unconfirmed data. Empty hours arrays represent published closures.

Availability is calculated for each response from published schedules, with dated exceptions ahead of weekly hours. Opening is inclusive and closing is exclusive. A dated list that omits a location, an unavailable exception source without a cached copy, or missing weekly hours can produce `open: null`. This is a schedule estimate. Some special hours appear only in free-text notes. The Fall/Spring baseline has no machine-readable effective dates and should be checked against TTU during term transitions. `rotation` records TTU's rotation label. The source provides no verified calendar anchor to determine the active menu week.

Nutrition matching uses an exact normalized name within the corresponding dining location and filters out conflicting published rotation weeks. Multiple matching published records are returned as candidates. IDs inside menu and nutrition documents are scoped to the document and can change when TTU edits its rows. The API preserves published allergen wording and does not treat a blank allergen cell as an assurance of safety.

## Sources and collection scope

- [TTU Hospitality Services](https://www.depts.ttu.edu/hospitality/index.php) supplies the directory, location detail pages and their linked restaurant menus.
- [TTU Fall & Spring Dining Hours](https://www.depts.ttu.edu/hospitality/dining_hours.php) supplies weekly intervals. [TTU Temporary Dining Hours](https://www.depts.ttu.edu/hospitality/Dining-Hours-Temporary.php) supplies published dated schedules such as Thanksgiving and finals. Other channels and inactive seasonal pages are outside the active schedule calculation.
- [TTU Smart Choices](https://www.depts.ttu.edu/hospitality/smartchoices/nutrition.php) links structured campus nutrition tables and external national-brand calculators. Seasonal Soups remains a campus-wide nutrition document. It has no verified individual dining-location assignment.
- TTU embeds the [Nutritionix calculator](https://restaurant.nutritionix.com/texas-tech-university/landing). The API publishes this reference and TTU's national-brand links. Nutritionix requires application credentials and restricts scheduled server requests and caching without written agreement, so its data is outside the automated collector. Brand links may show general chain data and may vary by market. [Nutritionix authentication](https://developer.nutritionix.com/docs/v2/authentication) · [Nutritionix API terms](https://developer.nutritionix.com/signup).

The parsers validate required headings, table shapes, weekday coverage and date/time values. Structure errors appear in `issues` and keep the previous source document available. Saved TTU HTML excerpts exercise parsers and cached fallback without fetching live URLs in tests.
