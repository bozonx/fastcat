export function dirname(path: string): string { const parts = path.split('/'); return parts.length > 1 ? parts.slice(0, -1).join('/') : ''; }
