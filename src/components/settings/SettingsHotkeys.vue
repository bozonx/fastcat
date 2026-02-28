<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import { DEFAULT_HOTKEYS, type HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import {
  hotkeyFromKeyboardEvent,
  isEditableTarget,
  normalizeHotkeyCombo,
} from '~/utils/hotkeys/hotkeyUtils';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isCapturingHotkey = ref(false);
const captureTargetCommandId = ref<HotkeyCommandId | null>(null);
const capturedCombo = ref<string | null>(null);
const isDuplicateConfirmOpen = ref(false);
const duplicateWarningText = ref('');
const duplicateOwnerCommandId = ref<HotkeyCommandId | null>(null);

let captureKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

const isResetAllHotkeysConfirmOpen = ref(false);
const resetCommandConfirmTarget = ref<HotkeyCommandId | null>(null);
const isResetCommandConfirmOpen = ref(false);

function getCommandTitle(cmdId: HotkeyCommandId): string {
  return DEFAULT_HOTKEYS.commands.find((c) => c.id === cmdId)?.title ?? cmdId;
}

function getCommandGroupTitle(groupId: string): string {
  if (groupId === 'general') return t('videoEditor.settings.hotkeysGroupGeneral', 'General');
  if (groupId === 'playback') return t('videoEditor.settings.hotkeysGroupPlayback', 'Playback');
  if (groupId === 'timeline') return t('videoEditor.settings.hotkeysGroupTimeline', 'Timeline');
  return groupId;
}

function getCurrentBindings(cmdId: HotkeyCommandId): string[] {
  const overrides = workspaceStore.userSettings.hotkeys.bindings[cmdId];
  if (Array.isArray(overrides)) return overrides;
  return DEFAULT_HOTKEYS.bindings[cmdId] ?? [];
}

function isCommandCustom(cmdId: HotkeyCommandId): boolean {
  return Array.isArray(workspaceStore.userSettings.hotkeys.bindings[cmdId]);
}

function setBindings(cmdId: HotkeyCommandId, next: string[]) {
  void workspaceStore.batchUpdateUserSettings(
    (draft) => {
      draft.hotkeys.bindings[cmdId] = [...next];
    },
    { immediate: true },
  );
}

function removeBinding(cmdId: HotkeyCommandId, combo: string) {
  const next = getCurrentBindings(cmdId).filter((c) => c !== combo);
  setBindings(cmdId, next);
}

function resetCommandBindings(cmdId: HotkeyCommandId) {
  resetCommandConfirmTarget.value = cmdId;
  isResetCommandConfirmOpen.value = true;
}

function resetAllHotkeys() {
  isResetAllHotkeysConfirmOpen.value = true;
}

function confirmResetAllHotkeys() {
  isResetAllHotkeysConfirmOpen.value = false;
  void workspaceStore.batchUpdateUserSettings(
    (draft) => {
      draft.hotkeys.bindings = {};
    },
    { immediate: true },
  );
}

function confirmResetCommandHotkeys() {
  const cmdId = resetCommandConfirmTarget.value;
  isResetCommandConfirmOpen.value = false;
  resetCommandConfirmTarget.value = null;
  if (!cmdId) return;
  void workspaceStore.batchUpdateUserSettings(
    (draft) => {
      delete draft.hotkeys.bindings[cmdId];
    },
    { immediate: true },
  );
}

function findDuplicateOwner(combo: string, targetCmdId: HotkeyCommandId): HotkeyCommandId | null {
  const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);
  for (const cmd of DEFAULT_HOTKEYS.commands) {
    if (cmd.id === targetCmdId) continue;
    const bindings = effective[cmd.id];
    if (bindings.includes(combo)) return cmd.id;
  }
  return null;
}

function finishCapture() {
  if (captureKeydownHandler) {
    window.removeEventListener('keydown', captureKeydownHandler, true);
    captureKeydownHandler = null;
  }
  isCapturingHotkey.value = false;
  captureTargetCommandId.value = null;
  capturedCombo.value = null;
  duplicateOwnerCommandId.value = null;
}

function startCapture(cmdId: HotkeyCommandId) {
  if (isCapturingHotkey.value) return;
  isCapturingHotkey.value = true;
  captureTargetCommandId.value = cmdId;
  capturedCombo.value = null;

  const handler = (e: KeyboardEvent) => {
    if (!isCapturingHotkey.value) {
      window.removeEventListener('keydown', handler, true);
      if (captureKeydownHandler === handler) captureKeydownHandler = null;
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      window.removeEventListener('keydown', handler, true);
      if (captureKeydownHandler === handler) captureKeydownHandler = null;
      finishCapture();
      return;
    }

    if (isEditableTarget(e.target)) {
      return;
    }

    const comboRaw = hotkeyFromKeyboardEvent(e);
    const combo = comboRaw ? normalizeHotkeyCombo(comboRaw) : null;
    if (!combo) return;

    e.preventDefault();
    window.removeEventListener('keydown', handler, true);
    if (captureKeydownHandler === handler) captureKeydownHandler = null;
    capturedCombo.value = combo;

    const target = captureTargetCommandId.value;
    if (!target) {
      finishCapture();
      return;
    }

    const owner = findDuplicateOwner(combo, target);
    if (owner) {
      duplicateWarningText.value = `${combo} is already assigned to ${getCommandTitle(owner)}.`;
      duplicateOwnerCommandId.value = owner;
      isDuplicateConfirmOpen.value = true;
      return;
    }

    const next = [...getCurrentBindings(target), combo];
    setBindings(target, Array.from(new Set(next)));
    finishCapture();
  };

  captureKeydownHandler = handler;
  window.addEventListener('keydown', handler, true);
}

function confirmAddDuplicate() {
  const target = captureTargetCommandId.value;
  const combo = capturedCombo.value;
  if (!target || !combo) {
    isDuplicateConfirmOpen.value = false;
    finishCapture();
    return;
  }

  const next = [...getCurrentBindings(target), combo];
  setBindings(target, Array.from(new Set(next)));
  isDuplicateConfirmOpen.value = false;
  finishCapture();
}

function confirmReplaceDuplicate() {
  const target = captureTargetCommandId.value;
  const combo = capturedCombo.value;
  const owner = duplicateOwnerCommandId.value;
  if (!target || !combo || !owner) {
    isDuplicateConfirmOpen.value = false;
    finishCapture();
    return;
  }

  const ownerNext = getCurrentBindings(owner).filter((c) => c !== combo);
  const targetNext = Array.from(new Set([...getCurrentBindings(target), combo]));

  void workspaceStore.batchUpdateUserSettings(
    (draft) => {
      draft.hotkeys.bindings[owner] = ownerNext;
      draft.hotkeys.bindings[target] = targetNext;
    },
    { immediate: true },
  );

  isDuplicateConfirmOpen.value = false;
  finishCapture();
}

const hotkeyGroups = computed(() => {
  const groupIds = Array.from(new Set(DEFAULT_HOTKEYS.commands.map((c) => c.groupId)));
  return groupIds.map((groupId) => ({
    id: groupId,
    title: getCommandGroupTitle(groupId),
    commands: DEFAULT_HOTKEYS.commands.filter((c) => c.groupId === groupId),
  }));
});

const hotkeyConflicts = computed(() => {
  const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);
  const counts = new Map<string, number>();

  for (const cmd of DEFAULT_HOTKEYS.commands) {
    const list = effective[cmd.id] ?? [];
    for (const combo of list) {
      counts.set(combo, (counts.get(combo) ?? 0) + 1);
    }
  }

  return counts;
});

function isConflicting(combo: string): boolean {
  return (hotkeyConflicts.value.get(combo) ?? 0) > 1;
}

onBeforeUnmount(() => {
  finishCapture();
});

defineExpose({
  finishCapture,
  isDuplicateConfirmOpen,
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isDuplicateConfirmOpen"
      :title="t('videoEditor.settings.hotkeysDuplicateTitle', 'Duplicate hotkey')"
      :description="duplicateWarningText"
      :confirm-text="t('videoEditor.settings.hotkeysDuplicateConfirm', 'Add anyway')"
      :secondary-text="t('videoEditor.settings.hotkeysDuplicateReplace', 'Replace')"
      secondary-color="warning"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="confirmAddDuplicate"
      @secondary="confirmReplaceDuplicate"
    />

    <UiConfirmModal
      v-model:open="isResetAllHotkeysConfirmOpen"
      :title="t('videoEditor.settings.hotkeysResetAllConfirmTitle', 'Reset all hotkeys?')"
      :description="
        t(
          'videoEditor.settings.hotkeysResetAllConfirmDesc',
          'This will remove all custom hotkeys and restore defaults. This action cannot be undone.',
        )
      "
      :confirm-text="t('videoEditor.settings.hotkeysResetAllConfirmAction', 'Reset')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="confirmResetAllHotkeys"
    />

    <UiConfirmModal
      v-model:open="isResetCommandConfirmOpen"
      :title="t('videoEditor.settings.hotkeysResetCommandConfirmTitle', 'Reset hotkey?')"
      :description="
        resetCommandConfirmTarget
          ? t('videoEditor.settings.hotkeysResetCommandConfirmDesc', {
              cmd: getCommandTitle(resetCommandConfirmTarget as HotkeyCommandId),
            })
          : ''
      "
      :confirm-text="t('videoEditor.settings.hotkeysResetCommandConfirmAction', 'Reset')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="confirmResetCommandHotkeys"
      @update:open="
        (v: boolean) => {
          if (!v) resetCommandConfirmTarget = null;
        }
      "
    />

    <div class="flex items-center justify-between gap-3 px-1">
      <div class="text-sm font-semibold text-ui-text">
        {{ t('videoEditor.settings.userHotkeys', 'Hotkeys') }}
      </div>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        :disabled="isCapturingHotkey"
        @click="resetAllHotkeys"
      >
        {{ t('videoEditor.settings.hotkeysResetAll', 'Reset all') }}
      </UButton>
      <div v-if="isCapturingHotkey" class="text-xs text-primary-500 font-medium animate-pulse">
        {{
          t(
            'videoEditor.settings.hotkeysCaptureHint',
            'Listening for key combination (Esc to cancel)',
          )
        }}
      </div>
    </div>

    <div class="flex flex-col gap-8">
      <div v-for="group in hotkeyGroups" :key="group.id" class="flex flex-col gap-3">
        <div class="text-[10px] font-bold text-ui-text-muted uppercase tracking-widest px-1">
          {{ group.title }}
        </div>

        <div class="overflow-hidden rounded-lg border border-ui-border bg-ui-bg">
          <table class="w-full border-collapse">
            <tbody class="divide-y divide-ui-border">
              <tr
                v-for="cmd in group.commands"
                :key="cmd.id"
                class="group hover:bg-ui-bg-accent/10 transition-colors"
              >
                <td class="w-[25%] p-2 py-2.5 align-top border-r border-ui-border/50">
                  <div class="flex flex-wrap gap-1.5 items-center">
                    <div
                      v-for="combo in getCurrentBindings(cmd.id)"
                      :key="combo"
                      class="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded border border-ui-border bg-ui-bg-accent/50 group-hover:bg-ui-bg-accent/80 transition-colors"
                      :class="{
                        'border-warning-400 text-warning-700 bg-warning-50/80':
                          isConflicting(combo),
                      }"
                      :title="
                        isConflicting(combo)
                          ? t(
                              'videoEditor.settings.hotkeysConflict',
                              'Conflict: used by another command',
                            )
                          : undefined
                      "
                    >
                      <span
                        class="text-[10px] font-mono font-medium text-ui-text-muted select-none"
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
                        @click="removeBinding(cmd.id, combo)"
                      />
                    </div>

                    <UButton
                      size="xs"
                      color="neutral"
                      variant="subtle"
                      icon="i-heroicons-plus"
                      class="h-6 w-6 rounded-full shrink-0 justify-center"
                      :disabled="isCapturingHotkey"
                      :loading="isCapturingHotkey && captureTargetCommandId === cmd.id"
                      @click="startCapture(cmd.id)"
                    />

                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      icon="i-heroicons-arrow-path"
                      class="h-6 w-6 rounded-full shrink-0 justify-center"
                      :disabled="isCapturingHotkey"
                      :aria-label="t('videoEditor.settings.hotkeysResetCommand', 'Reset')"
                      @click="resetCommandBindings(cmd.id)"
                    />
                  </div>
                  <div
                    v-if="isCapturingHotkey && captureTargetCommandId === cmd.id"
                    class="mt-1 text-[9px] text-primary-500 font-bold uppercase tracking-wider animate-pulse"
                  >
                    {{ t('videoEditor.settings.hotkeysCapturing', 'Listening') }}
                  </div>
                </td>
                <td class="p-3 py-2.5 align-middle">
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ cmd.title }}
                  </span>
                  <span
                    class="ml-2 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border"
                    :class="
                      isCommandCustom(cmd.id)
                        ? 'border-primary-300 text-primary-700 bg-primary-50'
                        : 'border-ui-border text-ui-text-muted bg-ui-bg'
                    "
                  >
                    {{
                      isCommandCustom(cmd.id)
                        ? t('common.custom', 'Custom')
                        : t('common.default', 'Default')
                    }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="text-[10px] text-ui-text-muted italic px-1">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
    </div>
  </div>
</template>
