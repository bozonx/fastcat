<script setup lang="ts">
import { computed } from 'vue';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';

interface HotkeySettingsCommand {
  id: HotkeyCommandId;
  groupId: string;
  title: string;
  visibility?: 'default' | 'advanced' | 'hidden';
}

const props = defineProps<{
  groupId: string;
  title: string;
  commands: HotkeySettingsCommand[];
  searchQuery: string;
  capturingCommandId: HotkeyCommandId | null;
  getCurrentBindings: (cmdId: HotkeyCommandId) => string[];
  formatBinding?: (combo: string) => string;
  isConflicting: (cmdId: HotkeyCommandId, combo: string) => boolean;
  isOverriding: (cmdId: HotkeyCommandId, combo: string) => boolean;
  isComboCustom: (cmdId: HotkeyCommandId, combo: string) => boolean;
  isCommandCustom: (cmdId: HotkeyCommandId) => boolean;
}>();

const emit = defineEmits<{
  (e: 'remove', cmdId: HotkeyCommandId, combo: string): void;
  (e: 'capture', cmdId: HotkeyCommandId): void;
  (e: 'reset', cmdId: HotkeyCommandId): void;
}>();

const { t } = useI18n();

const normalizedQuery = computed(() => props.searchQuery.toLowerCase().trim());
const primaryCommands = computed(() =>
  props.commands.filter(
    (command) => command.visibility !== 'advanced' && command.visibility !== 'hidden',
  ),
);
const advancedCommands = computed(() =>
  props.commands.filter((command) => command.visibility === 'advanced'),
);
const hasCustomAdvancedCommand = computed(() =>
  advancedCommands.value.some((command) => props.isCommandCustom(command.id)),
);
const shouldOpenAdvanced = computed(
  () => normalizedQuery.value.length > 0 || hasCustomAdvancedCommand.value,
);

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

function getBindingLabel(combo: string): string {
  return props.formatBinding?.(combo) ?? combo;
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <UiFormSectionHeader :title="title" class="px-1" />

    <div
      v-if="primaryCommands.length > 0"
      class="overflow-hidden rounded-lg border border-ui-border bg-ui-bg"
    >
      <table class="w-full border-collapse">
        <tbody class="divide-y divide-ui-border">
          <tr
            v-for="cmd in primaryCommands"
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
                      : isOverriding(cmd.id, combo)
                        ? 'border-blue-500/50 bg-blue-500/10'
                        : isComboCustom(cmd.id, combo)
                          ? 'border-yellow-500/50 bg-yellow-500/10'
                          : 'border-ui-border bg-ui-bg-accent/50 group-hover:bg-ui-bg-accent/80',
                  ]"
                  :title="
                    isConflicting(cmd.id, combo)
                      ? t('videoEditor.settings.hotkeysConflict')
                      : isOverriding(cmd.id, combo)
                        ? t('videoEditor.settings.hotkeysOverride')
                        : undefined
                  "
                >
                  <span
                    class="text-2xs font-mono font-medium select-none"
                    :class="[
                      isConflicting(cmd.id, combo)
                        ? 'text-error-600 dark:text-error-400'
                        : isOverriding(cmd.id, combo)
                          ? 'text-blue-600 dark:text-blue-400'
                          : isComboCustom(cmd.id, combo)
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-ui-text-muted',
                    ]"
                  >
                    {{ getBindingLabel(combo) }}
                  </span>
                  <UButton
                    size="2xs"
                    color="neutral"
                    variant="link"
                    icon="i-heroicons-x-mark"
                    class="p-0! h-4 w-4 opacity-40 hover:opacity-100 transition-opacity"
                    :aria-label="t('common.remove')"
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
                class="mt-1 text-3xs text-primary-500 font-bold tracking-wider animate-pulse"
              >
                {{ t('videoEditor.settings.hotkeysCapturing') }}
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
                  v-if="isCommandCustom(cmd.id)"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-heroicons-arrow-uturn-left"
                  class="h-6 w-6 rounded-full shrink-0 justify-center"
                  :disabled="capturingCommandId !== null"
                  :aria-label="t('videoEditor.settings.hotkeysResetCommand')"
                  @click="emit('reset', cmd.id)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <details
      v-if="advancedCommands.length > 0"
      class="overflow-hidden rounded-lg border border-ui-border bg-ui-bg"
      :open="shouldOpenAdvanced"
    >
      <summary
        class="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-ui-text-muted hover:bg-ui-bg-accent/10"
      >
        <span>{{ t('videoEditor.settings.hotkeysAdvanced') }}</span>
        <span class="text-xs text-ui-text-disabled">
          {{ advancedCommands.length }}
        </span>
      </summary>

      <table class="w-full border-collapse border-t border-ui-border">
        <tbody class="divide-y divide-ui-border">
          <tr
            v-for="cmd in advancedCommands"
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
                      : isOverriding(cmd.id, combo)
                        ? 'border-blue-500/50 bg-blue-500/10'
                        : isComboCustom(cmd.id, combo)
                          ? 'border-yellow-500/50 bg-yellow-500/10'
                          : 'border-ui-border bg-ui-bg-accent/50 group-hover:bg-ui-bg-accent/80',
                  ]"
                  :title="
                    isConflicting(cmd.id, combo)
                      ? t('videoEditor.settings.hotkeysConflict')
                      : isOverriding(cmd.id, combo)
                        ? t('videoEditor.settings.hotkeysOverride')
                        : undefined
                  "
                >
                  <span
                    class="text-2xs font-mono font-medium select-none"
                    :class="[
                      isConflicting(cmd.id, combo)
                        ? 'text-error-600 dark:text-error-400'
                        : isOverriding(cmd.id, combo)
                          ? 'text-blue-600 dark:text-blue-400'
                          : isComboCustom(cmd.id, combo)
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-ui-text-muted',
                    ]"
                  >
                    {{ getBindingLabel(combo) }}
                  </span>
                  <UButton
                    size="2xs"
                    color="neutral"
                    variant="link"
                    icon="i-heroicons-x-mark"
                    class="p-0! h-4 w-4 opacity-40 hover:opacity-100 transition-opacity"
                    :aria-label="t('common.remove')"
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
                class="mt-1 text-3xs text-primary-500 font-bold tracking-wider animate-pulse"
              >
                {{ t('videoEditor.settings.hotkeysCapturing') }}
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
                  v-if="isCommandCustom(cmd.id)"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-heroicons-arrow-uturn-left"
                  class="h-6 w-6 rounded-full shrink-0 justify-center"
                  :disabled="capturingCommandId !== null"
                  :aria-label="t('videoEditor.settings.hotkeysResetCommand')"
                  @click="emit('reset', cmd.id)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </details>
  </div>
</template>
