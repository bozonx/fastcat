import type { Ref } from 'vue';

interface WarningEntry {
  message: string;
  count: number;
}

export function createGroupedWarningReporter(target: Ref<string[]>) {
  const entries = new Map<string, WarningEntry>();

  function syncTarget() {
    target.value = Array.from(entries.values()).map((entry) =>
      entry.count > 1 ? `${entry.message} (x${entry.count})` : entry.message,
    );
  }

  return (message: string) => {
    const normalized = message.trim();
    if (!normalized) return;
    const existing = entries.get(normalized);
    if (existing) {
      existing.count += 1;
    } else {
      entries.set(normalized, { message: normalized, count: 1 });
    }
    syncTarget();
  };
}
