/**
 * Build tool (NOT runtime): reads an OpenFoodFacts CSV/TSV export and emits
 * prisma/data/foods.off.json (array of SeedFood). Run manually to (re)generate
 * the bulk food dataset.
 *
 * Usage:
 *   npx ts-node scripts/import-off-foods.ts <path-to-off-export.csv> [maxRows]
 *
 * The OFF full export is Open Database License (ODbL): attribution required.
 * Download: https://world.openfoodfacts.org/data (CSV export, tab-separated).
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { SeedFood } from '../src/lib/nutrition/foodSeed';
import { num, hasSaneMacros } from '../src/lib/nutrition/offMacros';

export interface OffRow {
  code?: string;
  product_name?: string;
  brands?: string;
  countries_tags?: string;
  'energy-kcal_100g'?: string | number;
  proteins_100g?: string | number;
  carbohydrates_100g?: string | number;
  fat_100g?: string | number;
}

/**
 * The OFF export has no language column — products are filtered by the market
 * they are sold in (`countries_tags`, e.g. "en:germany,en:spain").
 */
const RIOPLATENSE_TAGS = ['en:argentina', 'en:uruguay'];
const LATAM_TAGS = [
  'en:mexico',
  'en:chile',
  'en:colombia',
  'en:peru',
  'en:bolivia',
  'en:paraguay',
  'en:ecuador',
  'en:venezuela',
  'en:costa-rica',
  'en:guatemala',
  'en:panama',
  'en:honduras',
  'en:nicaragua',
  'en:el-salvador',
  'en:dominican-republic',
  'en:cuba',
  'en:puerto-rico',
];
const SPAIN_TAGS = ['en:spain'];
const SPANISH_SPEAKING_TAGS = new Set([...RIOPLATENSE_TAGS, ...LATAM_TAGS, ...SPAIN_TAGS]);

function countryTagsOf(row: OffRow): string[] {
  return (row.countries_tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export function isSpanishSpeakingRow(row: OffRow): boolean {
  return countryTagsOf(row).some((t) => SPANISH_SPEAKING_TAGS.has(t));
}

/**
 * Lower is better. Rioplatense products are the most relevant for this app's
 * users, then the rest of Latin America, then Spain.
 */
export function regionPriority(row: OffRow): number {
  const tags = countryTagsOf(row);
  if (tags.some((t) => RIOPLATENSE_TAGS.includes(t))) return 0;
  if (tags.some((t) => LATAM_TAGS.includes(t))) return 1;
  if (tags.some((t) => SPAIN_TAGS.includes(t))) return 2;
  return 3;
}

export function isUsableOffRow(row: OffRow): boolean {
  const name = (row.product_name ?? '').trim();
  if (name.length < 2) return false;
  if (!row.code) return false;
  const kcal = num(row['energy-kcal_100g']);
  const p = num(row.proteins_100g);
  const c = num(row.carbohydrates_100g);
  const f = num(row.fat_100g);
  if (kcal === null || p === null || c === null || f === null) return false;
  return hasSaneMacros(kcal, p, c, f);
}

export function mapOffRowToSeedFood(row: OffRow): SeedFood {
  const brand = (row.brands ?? '').split(',')[0]?.trim() || null;
  return {
    externalId: `off:${row.code}`,
    name: (row.product_name ?? '').trim(),
    brand,
    barcode: String(row.code),
    caloriesPer100g: num(row['energy-kcal_100g']) as number,
    proteinPer100g: num(row.proteins_100g) as number,
    carbsPer100g: num(row.carbohydrates_100g) as number,
    fatPer100g: num(row.fat_100g) as number,
    servingName: '100g',
    isGramBased: true,
    source: 'OPEN_FOOD_FACTS',
  };
}

// --- streaming main (only runs when invoked directly) ---
async function main() {
  const [inputPath, maxRowsArg] = process.argv.slice(2);
  if (!inputPath) {
    console.error('Usage: ts-node scripts/import-off-foods.ts <off-export.csv> [maxRows]');
    process.exit(1);
  }
  const parsedMaxRows = maxRowsArg ? parseInt(maxRowsArg, 10) : 2000;
  const maxRows = Number.isNaN(parsedMaxRows) ? 2000 : parsedMaxRows;

  const rl = createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity });
  const seen = new Set<string>();
  const candidates: Array<{ food: SeedFood; priority: number }> = [];
  let scanned = 0;

  // Only these 8 of the export's ~211 columns are needed. Building a full
  // 211-property object per row exhausts the heap on a 4M-row export, so the
  // column indexes are resolved once from the header and each row is projected
  // down to just what matters.
  const NEEDED = [
    'code',
    'product_name',
    'brands',
    'countries_tags',
    'energy-kcal_100g',
    'proteins_100g',
    'carbohydrates_100g',
    'fat_100g',
  ] as const;
  let colIndex: Array<[(typeof NEEDED)[number], number]> | null = null;

  // The whole file is scanned (no early break): candidates are ranked by region
  // afterwards, so stopping early would just bias the result towards whatever
  // happens to come first in the export.
  for await (const line of rl) {
    const cols = line.split('\t');
    if (!colIndex) {
      colIndex = NEEDED.map((name) => [name, cols.indexOf(name)] as [(typeof NEEDED)[number], number]);
      const missing = colIndex.filter(([, i]) => i < 0).map(([n]) => n);
      if (missing.length) {
        console.error(`Export is missing required columns: ${missing.join(', ')}`);
        process.exit(1);
      }
      continue;
    }
    const row: OffRow = {};
    for (const [name, i] of colIndex) {
      (row as Record<string, string>)[name] = cols[i];
    }
    scanned++;
    if (scanned % 500000 === 0) {
      console.log(`   …scanned ${scanned.toLocaleString()} rows, ${candidates.length} candidates`);
    }
    if (!isSpanishSpeakingRow(row)) continue;
    if (!isUsableOffRow(row)) continue;
    const key = String(row.code);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ food: mapOffRowToSeedFood(row), priority: regionPriority(row) });
  }

  candidates.sort((a, b) => a.priority - b.priority);
  const out = candidates.slice(0, maxRows).map((c) => c.food);

  const dest = join(__dirname, '..', 'prisma', 'data', 'foods.off.json');
  writeFileSync(dest, JSON.stringify(out, null, 0));
  const kept = out.reduce<Record<number, number>>((acc, _f, i) => {
    const p = candidates[i].priority;
    acc[p] = (acc[p] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Wrote ${out.length} foods to ${dest}`);
  console.log(`   scanned ${scanned.toLocaleString()} rows, ${candidates.length} Spanish-market candidates`);
  console.log(`   region mix — rioplatense: ${kept[0] ?? 0}, latam: ${kept[1] ?? 0}, spain: ${kept[2] ?? 0}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
