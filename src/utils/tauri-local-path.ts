function normalizeSeparators(path: string): string {
  return path.replaceAll('\\', '/');
}

function stripLeadingSeparators(path: string): string {
  return path.replace(/^\/+/, '');
}

function stripTrailingSeparators(path: string): string {
  if (path === '/') return path;
  if (/^[A-Za-z]:\/?$/.test(path)) return path.replace(/\/?$/, '/');
  return path.replace(/\/+$/, '');
}

export function joinTauriFsPath(...parts: string[]): string {
  const [first, ...rest] = parts.filter((part) => part.length > 0).map(normalizeSeparators);
  if (!first) return '';

  return rest.reduce((current, part) => {
    const next = stripLeadingSeparators(part).replace(/\/+$/, '');
    if (!next) return current;

    const base = stripTrailingSeparators(current);
    if (base === '/') return `/${next}`;
    if (/^[A-Za-z]:\/$/.test(base)) return `${base}${next}`;
    return `${base}/${next}`;
  }, first);
}
