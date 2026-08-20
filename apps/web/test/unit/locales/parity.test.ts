import { describe, it, expect } from 'vitest';
import en from '~/locales/en-US.json';
import ru from '~/locales/ru-RU.json';
import es from '~/locales/es-419.json';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

describe('locale parity', () => {
  it('en-US, ru-RU and es-419 have identical key sets', () => {
    const enKeys = new Set(flattenKeys(en));
    const ruKeys = new Set(flattenKeys(ru));
    const esKeys = new Set(flattenKeys(es));

    const onlyInEn = [...enKeys].filter((k) => !ruKeys.has(k) || !esKeys.has(k));
    const onlyInRu = [...ruKeys].filter((k) => !enKeys.has(k) || !esKeys.has(k));
    const onlyInEs = [...esKeys].filter((k) => !enKeys.has(k) || !ruKeys.has(k));

    expect(onlyInEn).toEqual([]);
    expect(onlyInRu).toEqual([]);
    expect(onlyInEs).toEqual([]);
  });
});
