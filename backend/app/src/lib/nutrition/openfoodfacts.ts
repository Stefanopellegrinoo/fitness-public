import { env } from '../../config/env.config';
import type { SeedFood } from './foodSeed';
import { num, hasSaneMacros } from './offMacros';

export interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string | string[];
  nutriments?: Record<string, unknown>;
}

export function mapOffProductToSeedFood(p: OffProduct): SeedFood | null {
  const name = (p.product_name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2) return null;
  if (!p.code) return null;
  const nut = p.nutriments ?? {};
  const kcal = num(nut['energy-kcal_100g']);
  const protein = num(nut['proteins_100g']);
  const carbs = num(nut['carbohydrates_100g']);
  const fat = num(nut['fat_100g']);
  if (kcal === null || protein === null || carbs === null || fat === null) return null;
  if (!hasSaneMacros(kcal, protein, carbs, fat)) return null;
  const brandRaw = Array.isArray(p.brands) ? p.brands[0] : (p.brands ?? '').split(',')[0];
  const brand = brandRaw?.trim() || null;
  return {
    externalId: `off:${p.code}`,
    name,
    brand,
    barcode: String(p.code),
    caloriesPer100g: kcal,
    proteinPer100g: protein,
    carbsPer100g: carbs,
    fatPer100g: fat,
    servingName: '100g',
    isGramBased: true,
    source: 'OPEN_FOOD_FACTS',
  };
}

async function offFetchJson(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.OFF_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': env.OFF_USER_AGENT }, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOffProductByBarcode(barcode: string): Promise<SeedFood | null> {
  const url = `${env.OFF_BASE_URL}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=code,product_name,brands,nutriments`;
  const json = await offFetchJson(url);
  if (!json || json.status !== 1 || !json.product) return null;
  return mapOffProductToSeedFood(json.product as OffProduct);
}

export async function searchOffProducts(query: string, limit: number): Promise<SeedFood[]> {
  const url = `${env.OFF_SEARCH_URL}/search?q=${encodeURIComponent(query)}&page_size=${limit}&fields=code,product_name,brands,nutriments`;
  const json = await offFetchJson(url);
  const hits: OffProduct[] = json?.hits ?? [];
  return hits.map(mapOffProductToSeedFood).filter((f): f is SeedFood => f !== null);
}
