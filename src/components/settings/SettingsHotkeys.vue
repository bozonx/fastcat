<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { LayerKey } from '~/utils/hotkeys/layerUtils';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import SearchInput from '~/components/ui/SearchInput.vue';
import { DEFAULT_HOTKEYS, type HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import {
  hotkeyFromKeyboardEvent,
  isEditableTarget,
  normalizeHotkeyCombo,
} from '~/utils/hotkeys/hotkeyUtils';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import {
  findDuplicateOwnerByContext,
  getHotkeyConflicts,
  isHotkeyConflicting,
} from '~/utils/hotkeys/hotkeyConflicts';

import SettingsHotkeysGroup from './hotkeys/SettingsHotkeysGroup.vue';

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

const searchQuery = ref('');

const normalizedQuery = computed(() => searchQuery.value.toLowerCase().trim());

const hardcodedHotkeysHint = computed(() =>
  t('videoEditor.settings.hotkeysHardcodedHint')
);

function getCommandTitle(cmdId: HotkeyCommandId): string {
  const fallback = DEFAULT_HOTKEYS.commands.find((c) => c.id === cmdId)?.title ?? cmdId;
  return t(`videoEditor.hotkeys.${cmdId}`, fallback);
}

function getCommandGroupTitle(groupId: string): string {
  if (groupId === 'general') return t('videoEditor.settings.hotkeysGroupGeneral', 'General');
  if (groupId === 'playback') return t('videoEditor.settings.hotkeysGroupPlayback', 'Playback');
  if (groupId === 'timeline') return t('videoEditor.settings.hotkeysGroupTimeline', 'Timeline');
  return groupId;
}

const layerOptions = [
  { label: 'Shift (Any)', value: 'Shift' },
  { label: 'Control (Any)', value: 'Control' },
  { label: 'Alt (Any)', value: 'Alt' },
  { label: 'Meta (Any)', value: 'Meta' },
  { label: 'Left Shift', value: 'ShiftLeft' },
  { label: 'Right Shift', value: 'ShiftRight' },
  { label: 'Left Control', value: 'ControlLeft' },
  { label: 'Right Control', value: 'ControlRight' },
  { label: 'Left Alt', value: 'AltLeft' },
  { label: 'Right Alt', value: 'AltRight' },
  { label: 'Left Meta', value: 'MetaLeft' },
  { label: 'Right Meta', value: 'MetaRight' },
];

function updateLayer1(val: LayerKey) {
  if (!val) return;
  void workspaceStore.batchUpdateUserSettings((draft) => {
    draft.hotkeys.layer1 = val;
  });
}

function updateLayer2(val: LayerKey) {
  if (!val) return;
  void workspaceStore.batchUpdateUserSettings((draft) => {
    draft.hotkeys.layer2 = val;
  });
}

function getCurrentBindings(cmdId: HotkeyCommandId): string[] {
  const overrides = workspaceStore.userSettings.hotkeys.bindings[cmdId];
  if (Array.isArray(overrides)) return overrides;
  return DEFAULT_HOTKEYS.bindings[cmdId] ?? [];
}

function isComboCustom(cmdId: HotkeyCommandId, combo: string): boolean {
  const defaultBindings = DEFAULT_HOTKEYS.bindings[cmdId] || [];
  return !defaultBindings.includes(combo);
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
  return findDuplicateOwnerByContext({
    effective,
    commands: DEFAULT_HOTKEYS.commands,
    targetCmdId,
    combo,
  });
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

    const comboRaw = hotkeyFromKeyboardEvent(e, workspaceStore.userSettings);
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
  const query = normalizedQuery.value;
  const groupIds = Array.from(new Set(DEFAULT_HOTKEYS.commands.map((c) => c.groupId)));
  return groupIds
    .map((groupId) => {
      const commands = DEFAULT_HOTKEYS.commands.filter((c) => {
        if (c.groupId !== groupId) return false;
        if (!query) return true;
        return getCommandTitle(c.id).toLowerCase().includes(query);
      });

      return {
        id: groupId,
        title: getCommandGroupTitle(groupId),
        commands,
      };
    })
    .filter((g) => g.commands.length > 0);
});

const hotkeyConflicts = computed(() => {
  const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);
  return getHotkeyConflicts(effective);
});

function isConflicting(cmdId: HotkeyCommandId, combo: string): boolean {
  return isHotkeyConflicting({ conflicts: hotkeyConflicts.value, cmdId, combo });
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

    <div class="px-1">
      <SearchInput
        v-model="searchQuery"
        :placeholder="t('common.search', 'Search')"
        :disabled="isCapturingHotkey"
      />
    </div>

    <div class="grid grid-cols-2 gap-4 px-1">
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-ui-text-muted">
          {{ t('videoEditor.settings.hotkeysLayer1', 'Layer 1 (Default: Shift)') }}
        </label>
        <USelectMenu
          :model-value="workspaceStore.userSettings.hotkeys.layer1 ?? 'Shift'"
          :items="layerOptions"
          value-key="value"
          :search-input="false"
          @update:model-value="(val) => updateLayer1(val as LayerKey)"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-ui-text-muted">
          {{ t('videoEditor.settings.hotkeysLayer2', 'Layer 2 (Default: Ctrl)') }}
        </label>
        <USelectMenu
          :model-value="workspaceStore.userSettings.hotkeys.layer2 ?? 'Control'"
          :items="layerOptions"
          value-key="value"
          :search-input="false"
          @update:model-value="(val) => updateLayer2(val as LayerKey)"
        />
      </div>
    </div>

    <div v-if="hotkeyGroups.length === 0" class="px-1 py-8 text-center text-sm text-ui-text-muted">
      {{ t('common.noResults', 'No results found') }}
    </div>

    <div v-else class="flex flex-col gap-8">
      <SettingsHotkeysGroup
        v-for="group in hotkeyGroups"
        :key="group.id"
        :group-id="group.id"
        :title="group.title"
        :commands="group.commands"
        :search-query="searchQuery"
        :capturing-command-id="captureTargetCommandId"
        :get-current-bindings="getCurrentBindings"
        :is-conflicting="isConflicting"
        :is-combo-custom="isComboCustom"
        @remove="removeBinding"
        @capture="startCapture"
        @reset="resetCommandBindings"
      />
    </div>

    <div class="text-[10px] text-ui-text-muted italic px-1">
      {{ hardcodedHotkeysHint }}
    </div>

  </div>
</template>
