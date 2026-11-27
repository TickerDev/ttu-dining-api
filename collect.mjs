import { createDiningService } from './lib/service.mjs';
import { coverage } from './lib/coverage.mjs';

try {
  const data = await createDiningService()();
  const output = process.argv.includes('--coverage') ? {
    checkedAt: data.checkedAt, sources: data.sources, issues: data.issues, nutritionix: data.nutritionix,
    locations: coverage(data)
  } : data;
  console.log(JSON.stringify(output, null, 2));
  if (data.stale) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
