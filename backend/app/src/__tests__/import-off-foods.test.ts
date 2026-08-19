import { describe, it, expect } from 'vitest';
import {
  isUsableOffRow,
  mapOffRowToSeedFood,
  isSpanishSpeakingRow,
  regionPriority,
  type OffRow,
} from '../../scripts/import-off-foods';

const valid: OffRow = {
  code: '7791234567890',
  product_name: 'Galletitas de Arroz',
  brands: 'Marca A, Marca B',
  'energy-kcal_100g': '387',
  proteins_100g: '8',
  carbohydrates_100g: '80',
  fat_100g: '3',
};

describe('isUsableOffRow', () => {
  it('accepts a row with name, code and complete macros', () => {
    expect(isUsableOffRow(valid)).toBe(true);
  });

  it('rejects a row missing macros', () => {
    expect(isUsableOffRow({ ...valid, proteins_100g: '' })).toBe(false);
  });

  it('rejects a row without a product name', () => {
    expect(isUsableOffRow({ ...valid, product_name: '' })).toBe(false);
  });

  it('rejects insane kcal values', () => {
    expect(isUsableOffRow({ ...valid, 'energy-kcal_100g': '5000' })).toBe(false);
  });

  it('rejects a row without a barcode', () => {
    expect(isUsableOffRow({ ...valid, code: undefined })).toBe(false);
  });
});

describe('isSpanishSpeakingRow', () => {
  it('accepts a product sold in Spain', () => {
    expect(isSpanishSpeakingRow({ ...valid, countries_tags: 'en:spain' })).toBe(true);
  });

  it('accepts a product sold in a Spanish-speaking country among others', () => {
    expect(isSpanishSpeakingRow({ ...valid, countries_tags: 'en:germany,en:argentina' })).toBe(true);
  });

  it('rejects a product sold only in non-Spanish-speaking countries', () => {
    expect(isSpanishSpeakingRow({ ...valid, countries_tags: 'en:france,en:germany' })).toBe(false);
  });

  it('rejects a row with no countries_tags', () => {
    expect(isSpanishSpeakingRow({ ...valid, countries_tags: undefined })).toBe(false);
  });

  it('does not match on a country tag that merely contains a shorter tag', () => {
    // "en:spain" must not be matched by a substring check against "en:spain-and-portugal"
    expect(isSpanishSpeakingRow({ ...valid, countries_tags: 'en:new-spain-territory' })).toBe(false);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isSpanishSpeakingRow({ ...valid, countries_tags: 'en:france, en:mexico' })).toBe(true);
  });
});

describe('regionPriority', () => {
  it('ranks Argentina ahead of Spain', () => {
    const ar = regionPriority({ ...valid, countries_tags: 'en:argentina' });
    const es = regionPriority({ ...valid, countries_tags: 'en:spain' });
    expect(ar).toBeLessThan(es);
  });

  it('ranks other Latin American countries ahead of Spain', () => {
    const mx = regionPriority({ ...valid, countries_tags: 'en:mexico' });
    const es = regionPriority({ ...valid, countries_tags: 'en:spain' });
    expect(mx).toBeLessThan(es);
  });

  it('takes the best rank when several countries are listed', () => {
    expect(regionPriority({ ...valid, countries_tags: 'en:spain,en:argentina' })).toBe(
      regionPriority({ ...valid, countries_tags: 'en:argentina' })
    );
  });
});

describe('mapOffRowToSeedFood', () => {
  it('maps to a SeedFood with off: externalId, OPEN_FOOD_FACTS source and first brand', () => {
    const f = mapOffRowToSeedFood(valid);
    expect(f.externalId).toBe('off:7791234567890');
    expect(f.barcode).toBe('7791234567890');
    expect(f.source).toBe('OPEN_FOOD_FACTS');
    expect(f.name).toBe('Galletitas de Arroz');
    expect(f.brand).toBe('Marca A');
    expect(f.caloriesPer100g).toBe(387);
    expect(f.proteinPer100g).toBe(8);
  });
});
