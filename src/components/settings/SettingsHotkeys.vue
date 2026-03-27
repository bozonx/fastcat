<script setup lang="ts">
import { computed, ref } from 'vue';

import { useWorkspaceStore } from '~/stores/workspace.store';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiSearchInput from '~/components/ui/UiSearchInput.vue';
import { DEFAULT_HOTKEYS, type HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import {
  findDuplicateOwnerByContext,
  getHotkeyConflicts,
  isHotkeyConflicting,
} from '~/utils/hotkeys/hotkeyConflicts';
import { useHotkeyCapture } from '~/composables/settings/useHotkeyCapture';

import SettingsHotkeysGroup from './hotkeys/SettingsHotkeysGroup.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isDuplicateConfirmOpen = ref(false);
const duplicateWarningText = ref('');
const duplicateOwnerCommandId = ref<HotkeyCommandId | null>(null);

const isResetAllHotkeysConfirmOpen = ref(false);
const resetCommandConfirmTarget = ref<HotkeyCommandId | null>(null);
const isResetCommandConfirmOpen = ref(false);

const searchQuery = ref('');
const normalizedQuery = computed(() => searchQuery.value.toLowerCase().trim());

const { isCapturingHotkey, captureTargetCommandId, capturedCombo, startCapture, finishCapture } =
  useHotkeyCapture({
    onCaptured: (cmdId, combo) => {
      const next = [...getCurrentBindings(cmdId), combo];
      setBindings(cmdId, Array.from(new Set(next)));
    },
    onDuplicate: (cmdId, combo, owner) => {
      duplicateWarningText.value = t('videoEditor.settings.hotkeysDuplicateWarning', {
        combo,
        cmd: getCommandTitle(owner),
      });
      duplicateOwnerCommandId.value = owner;
      isDuplicateConfirmOpen.value = true;
    },
    findDuplicateOwner: (combo, targetCmdId) => {
      const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);
      return findDuplicateOwnerByContext({
        effective,
        commands: DEFAULT_HOTKEYS.commands,
        targetCmdId,
        combo,
      });
    },
  });

function getCommandTitle(cmdId: HotkeyCommandId): string {
  const fallback = DEFAULT_HOTKEYS.commands.find((c) => c.id === cmdId)?.title ?? cmdId;
  return t(`videoEditor.hotkeys.${cmdId}`, fallback);
}

function getCommandGroupTitle(groupId: string): string {
  const titles: Record<string, string> = {
    general: t('videoEditor.settings.hotkeysGroupGeneral', 'General'),
    playback: t('videoEditor.settings.hotkeysGroupPlayback', 'Playback'),
    timeline: t('videoEditor.settings.hotkeysGroupTimeline', 'Timeline'),
  };
  return titles[groupId] || groupId;
}

function getCurrentBindings(cmdId: HotkeyCommandId): string[] {
  return (
    workspaceStore.userSettings.hotkeys.bindings[cmdId] ?? DEFAULT_HOTKEYS.bindings[cmdId] ?? []
  );
}

function isComboCustom(cmdId: HotkeyCommandId, combo: string): boolean {
  return !(DEFAULT_HOTKEYS.bindings[cmdId] || []).includes(combo);
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

function confirmAddDuplicate() {
  const target = captureTargetCommandId.value;
  const combo = capturedCombo.value;
  if (target && combo) {
    const next = [...getCurrentBindings(target), combo];
    setBindings(target, Array.from(new Set(next)));
  }
  isDuplicateConfirmOpen.value = false;
  finishCapture();
}

function confirmReplaceDuplicate() {
  const target = captureTargetCommandId.value;
  const combo = capturedCombo.value;
  const owner = duplicateOwnerCommandId.value;
  if (target && combo && owner) {
    const ownerNext = getCurrentBindings(owner).filter((c) => c !== combo);
    const targetNext = Array.from(new Set([...getCurrentBindings(target), combo]));
    void workspaceStore.batchUpdateUserSettings(
      (draft) => {
        draft.hotkeys.bindings[owner] = ownerNext;
        draft.hotkeys.bindings[target] = targetNext;
      },
      { immediate: true },
    );
  }
  isDuplicateConfirmOpen.value = false;
  finishCapture();
}

const hotkeyGroups = computed(() => {
  const query = normalizedQuery.value;
  const groupIds = Array.from(new Set(DEFAULT_HOTKEYS.commands.map((c) => c.groupId)));
  return groupIds
    .map((groupId) => ({
      id: groupId,
      title: getCommandGroupTitle(groupId),
      commands: DEFAULT_HOTKEYS.commands.filter((c) => {
        if (c.groupId !== groupId) return false;
        return !query || getCommandTitle(c.id).toLowerCase().includes(query);
      }),
    }))
    .filter((g) => g.commands.length > 0);
});

const hotkeyConflicts = computed(() => {
  const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);
  return getHotkeyConflicts(effective);
});

function isConflicting(cmdId: HotkeyCommandId, combo: string): boolean {
  return isHotkeyConflicting({ conflicts: hotkeyConflicts.value, cmdId, combo });
}

defineExpose({ finishCapture, isDuplicateConfirmOpen });
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
      :description="t('videoEditor.settings.hotkeysResetAllConfirmDesc')"
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
              cmd: getCommandTitle(resetCommandConfirmTarget),
            })
          : ''
      "
      :confirm-text="t('videoEditor.settings.hotkeysResetCommandConfirmAction', 'Reset')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="confirmResetCommandHotkeys"
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
        @click="isResetAllHotkeysConfirmOpen = true"
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

    <p class="px-1 text-xs text-ui-text-muted leading-relaxed">
      {{ t('videoEditor.settings.hotkeysLayersHint') }}
    </p>

    <div class="px-1">
      <UiSearchInput
        v-model="searchQuery"
        :placeholder="t('common.search', 'Search')"
        :disabled="isCapturingHotkey"
      />
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
        @reset="
          (cmdId) => {
            resetCommandConfirmTarget = cmdId;
            isResetCommandConfirmOpen = true;
          }
        "
      />
    </div>
  </div>
</template>
