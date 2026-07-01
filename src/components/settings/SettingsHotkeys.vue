<script setup lang="ts">
import { computed, ref } from 'vue';

import { useWorkspaceStore } from '~/stores/workspace.store';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiSearchInput from '~/components/ui/UiSearchInput.vue';
import {
  DEFAULT_HOTKEYS,
  type HotkeyCommandId,
  type HotkeyGroupId,
} from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import {
  findDuplicateOwnerByContext,
  findOverrideOwnerByContext,
  getHotkeyConflicts,
  getHotkeyOverrides,
  isHotkeyConflicting,
  isHotkeyOverriding,
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
const hotkeyGroupOrder: readonly HotkeyGroupId[] = [
  'general',
  'fileManager',
  'timelineMonitorGlobal',
  'timeline',
  'monitor',
];

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
    findOverrideOwner: (combo, targetCmdId) => {
      const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);
      return findOverrideOwnerByContext({
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
    general: t('videoEditor.settings.hotkeysGroupGeneral'),
    fileManager: t('videoEditor.settings.hotkeysGroupFileManager'),
    monitor: t('videoEditor.settings.hotkeysGroupMonitor'),
    timeline: t('videoEditor.settings.hotkeysGroupTimeline'),
    timelineMonitorGlobal: t('videoEditor.settings.hotkeysGroupTimelineMonitorGlobal'),
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
      Reflect.deleteProperty(draft.hotkeys.bindings, cmdId);
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
  const groupIds = hotkeyGroupOrder.filter((groupId) =>
    DEFAULT_HOTKEYS.commands.some((command) => command.groupId === groupId),
  );
  return groupIds
    .map((groupId) => ({
      id: groupId,
      title: getCommandGroupTitle(groupId),
      commands: DEFAULT_HOTKEYS.commands.filter((c) => {
        if (c.groupId !== groupId) return false;
        if (!query) return true;
        const translatedTitle = getCommandTitle(c.id).toLowerCase();
        const fallbackTitle = c.title.toLowerCase();
        return translatedTitle.includes(query) || fallbackTitle.includes(query);
      }),
    }))
    .filter((g) => g.commands.length > 0);
});

const hotkeyConflicts = computed(() => {
  const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);
  return getHotkeyConflicts(effective);
});

const hotkeyOverrides = computed(() => {
  const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);
  return getHotkeyOverrides(effective);
});

function isConflicting(cmdId: HotkeyCommandId, combo: string): boolean {
  return isHotkeyConflicting({ conflicts: hotkeyConflicts.value, cmdId, combo });
}

function isOverriding(cmdId: HotkeyCommandId, combo: string): boolean {
  return isHotkeyOverriding({ overrides: hotkeyOverrides.value, cmdId, combo });
}

defineExpose({ finishCapture, isDuplicateConfirmOpen });
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isDuplicateConfirmOpen"
      :title="t('videoEditor.settings.hotkeysDuplicateTitle')"
      :description="duplicateWarningText"
      :confirm-text="t('videoEditor.settings.hotkeysDuplicateConfirm')"
      :secondary-text="t('videoEditor.settings.hotkeysDuplicateReplace')"
      secondary-color="warning"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="confirmAddDuplicate"
      @secondary="confirmReplaceDuplicate"
    />

    <UiConfirmModal
      v-model:open="isResetAllHotkeysConfirmOpen"
      :title="t('videoEditor.settings.hotkeysResetAllConfirmTitle')"
      :description="t('videoEditor.settings.hotkeysResetAllConfirmDesc')"
      :confirm-text="t('videoEditor.settings.hotkeysResetAllConfirmAction')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="confirmResetAllHotkeys"
    />

    <UiConfirmModal
      v-model:open="isResetCommandConfirmOpen"
      :title="t('videoEditor.settings.hotkeysResetCommandConfirmTitle')"
      :description="
        resetCommandConfirmTarget
          ? t('videoEditor.settings.hotkeysResetCommandConfirmDesc', {
              cmd: getCommandTitle(resetCommandConfirmTarget),
            })
          : ''
      "
      :confirm-text="t('videoEditor.settings.hotkeysResetCommandConfirmAction')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="confirmResetCommandHotkeys"
    />

    <div class="flex items-center justify-between gap-3 px-1">
      <div class="text-sm font-semibold text-ui-text">
        {{ t('videoEditor.settings.userHotkeys') }}
      </div>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        :disabled="isCapturingHotkey"
        @click="void (isResetAllHotkeysConfirmOpen = true)"
      >
        {{ t('videoEditor.settings.hotkeysResetAll') }}
      </UButton>
      <div v-if="isCapturingHotkey" class="text-xs text-primary-500 font-medium animate-pulse">
        {{ t('videoEditor.settings.hotkeysCaptureHint') }}
      </div>
    </div>

    <div class="px-1">
      <UiSearchInput
        v-model="searchQuery"
        :placeholder="t('common.search')"
        :disabled="isCapturingHotkey"
      />
    </div>

    <UiEmptyState
      v-if="hotkeyGroups.length === 0"
      :message="t('common.noResults')"
      wrapper-class="px-1 py-8 text-sm not-italic"
    />

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
        :is-overriding="isOverriding"
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
