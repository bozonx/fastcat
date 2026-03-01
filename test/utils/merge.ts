function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

export function deepMerge<T>(base: T, overrides?: Partial<T>): T {
  if (!overrides) return base;

  const baseAny = base as any;
  const overridesAny = overrides as any;

  if (Array.isArray(baseAny) || Array.isArray(overridesAny)) {
    return (overridesAny ?? baseAny) as T;
  }

  if (!isPlainObject(baseAny) || !isPlainObject(overridesAny)) {
    return (overridesAny ?? baseAny) as T;
  }

  const out: Record<string, unknown> = { ...baseAny };

  for (const [key, value] of Object.entries(overridesAny)) {
    const current = (baseAny as Record<string, unknown>)[key];

    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = deepMerge(current, value);
      continue;
    }

    out[key] = value;
  }

  return out as T;
}
