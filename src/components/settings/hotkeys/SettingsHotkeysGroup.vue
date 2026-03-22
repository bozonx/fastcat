<script setup lang="ts">
import { computed } from 'vue';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';

const props = defineProps<{
  groupId: string;
  title: string;
  commands: { id: HotkeyCommandId; groupId: string; title: string }[];
  searchQuery: string;
  capturingCommandId: HotkeyCommandId | null;
  getCurrentBindings: (cmdId: HotkeyCommandId) => string[];
  isConflicting: (cmdId: HotkeyCommandId, combo: string) => boolean;
  isComboCustom: (cmdId: HotkeyCommandId, combo: string) => boolean;
}>();

const emit = defineEmits<{
  (e: 'remove', cmdId: HotkeyCommandId, combo: string): void;
  (e: 'capture', cmdId: HotkeyCommandId): void;
  (e: 'reset', cmdId: HotkeyCommandId): void;
}>();

const { t } = useI18n();

const normalizedQuery = computed(() => props.searchQuery.toLowerCase().trim());

function getCommandTitle(cmdId: HotkeyCommandId): string {
  const fallback = props.commands.find((c) => c.id === cmdId)?.title ?? cmdId;
  return t(`videoEditor.hotkeys.${cmdId}`, fallback);
}

function getTitleParts(cmdId: HotkeyCommandId) {
  const title = getCommandTitle(cmdId);
  const query = normalizedQuery.value;
  if (!query) return [{ text: title, match: false }];

  const lower = title.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) return [{ text: title, match: false }];

  const parts = [
    { text: title.slice(0, idx), match: false },
    { text: title.slice(idx, idx + query.length), match: true },
    { text: title.slice(idx + query.length), match: false },
  ];

  return parts.filter((p) => p.text.length > 0);
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="text-2xs font-bold text-ui-text-muted uppercase tracking-widest px-1">
      {{ title }}
    </div>

    <div class="overflow-hidden rounded-lg border border-ui-border bg-ui-bg">
      <table class="w-full border-collapse">
        <tbody class="divide-y divide-ui-border">
          <tr
            v-for="cmd in commands"
            :key="cmd.id"
            class="group hover:bg-ui-bg-accent/10 transition-colors"
          >
            <td class="w-[25%] p-2 py-2.5 align-top border-r border-ui-border/50">
              <div class="flex flex-wrap gap-1.5 items-center">
                <div
                  v-for="combo in getCurrentBindings(cmd.id)"
                  :key="combo"
                  class="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded border transition-colors"
                  :class="[
                    isConflicting(cmd.id, combo)
                      ? 'border-error-500/50 bg-error-500/10'
                      : isComboCustom(cmd.id, combo)
                        ? 'border-yellow-500/50 bg-yellow-500/10'
                        : 'border-ui-border bg-ui-bg-accent/50 group-hover:bg-ui-bg-accent/80',
                  ]"
                  :title="
                    isConflicting(cmd.id, combo)
                      ? t(
                          'videoEditor.settings.hotkeysConflict',
                          'Conflict: used by another command',
                        )
                      : undefined
                  "
                >
                  <span
                    class="text-2xs font-mono font-medium select-none"
                    :class="[
                      isConflicting(cmd.id, combo)
                        ? 'text-error-600 dark:text-error-400'
                        : isComboCustom(cmd.id, combo)
                          ? 'text-yellow-600 dark:text-yellow-400'
                          : 'text-ui-text-muted',
                    ]"
                  >
                    {{ combo }}
                  </span>
                  <UButton
                    size="2xs"
                    color="neutral"
                    variant="link"
                    icon="i-heroicons-x-mark"
                    class="p-0! h-4 w-4 opacity-40 hover:opacity-100 transition-opacity"
                    :aria-label="t('common.remove', 'Remove')"
                    @click="emit('remove', cmd.id, combo)"
                  />
                </div>

                <UButton
                  size="xs"
                  color="neutral"
                  variant="subtle"
                  icon="i-heroicons-plus"
                  class="h-6 w-6 rounded-full shrink-0 justify-center"
                  :disabled="capturingCommandId !== null"
                  :loading="capturingCommandId === cmd.id"
                  @click="emit('capture', cmd.id)"
                />
              </div>
              <div
                v-if="capturingCommandId === cmd.id"
                class="mt-1 text-3xs text-primary-500 font-bold uppercase tracking-wider animate-pulse"
              >
                {{ t('videoEditor.settings.hotkeysCapturing', 'Listening') }}
              </div>
            </td>
            <td class="p-3 py-2.5 align-middle">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center">
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    <template v-for="(part, idx) in getTitleParts(cmd.id)" :key="idx">
                      <span :class="part.match ? 'text-primary-600 font-semibold' : ''">
                        {{ part.text }}
                      </span>
                    </template>
                  </span>
                </div>

                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-heroicons-arrow-uturn-left"
                  class="h-6 w-6 rounded-full shrink-0 justify-center opacity-0 focus-visible:opacity-100 group-hover:opacity-100 transition-opacity"
                  :disabled="capturingCommandId !== null"
                  :aria-label="t('videoEditor.settings.hotkeysResetCommand', 'Reset')"
                  @click="emit('reset', cmd.id)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
