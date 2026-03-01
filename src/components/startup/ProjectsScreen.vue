<script setup lang="ts">
import { ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useUiStore } from '~/stores/ui.store';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const uiStore = useUiStore();

const newProjectName = ref('');

function leaveProject() {
  timelineStore.resetTimelineState();
  mediaStore.resetMediaState();
  projectStore.closeProject();
}

async function createNewProject() {
  if (!newProjectName.value.trim()) return;
  await projectStore.createProject(newProjectName.value.trim());
  if (workspaceStore.userSettings.openLastProjectOnStart) {
    await projectStore.openProject(newProjectName.value.trim());
  }
  newProjectName.value = '';
}

async function handleOpenProject(project: string) {
  leaveProject();
  await projectStore.openProject(project);
  uiStore.restoreFileTreeStateOnce(project);
  await timelineStore.loadTimeline();
  void timelineStore.loadTimelineMetadata();
}
</script>

<template>
  <div class="flex flex-col flex-1 bg-ui-bg p-8 overflow-y-auto">
    <div class="max-w-5xl w-full mx-auto space-y-8 pb-12">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-ui-text">
            {{ t('granVideoEditor.projects.title', 'Projects') }}
          </h1>
          <p class="text-ui-text-muted text-sm mt-1">
            Workspace: {{ workspaceStore.workspaceHandle?.name }}
          </p>
        </div>
        <UButton
          size="sm"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-arrow-left-on-rectangle"
          :label="t('granVideoEditor.projects.changeWorkspace', 'Change Workspace')"
          @click="workspaceStore.resetWorkspace"
        />
      </div>

      <div v-if="workspaceStore.error" class="text-error-400 text-sm">
        {{ workspaceStore.error }}
      </div>

      <!-- Last Project Hero Section -->
      <div
        v-if="
          workspaceStore.lastProjectName &&
          workspaceStore.projects.includes(workspaceStore.lastProjectName)
        "
        class="bg-linear-to-r from-primary-950/80 to-primary-900/40 border border-primary-500/30 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6"
      >
        <div class="space-y-2">
          <span class="text-primary-400 text-xs font-bold uppercase tracking-widest">
            {{ t('granVideoEditor.projects.continueWorking', 'Continue Working') }}
          </span>
          <h2 class="text-3xl font-bold text-ui-text">{{ workspaceStore.lastProjectName }}</h2>
        </div>
        <UButton
          size="xl"
          color="primary"
          class="px-8 shadow-lg shadow-primary-500/20"
          icon="i-heroicons-play"
          :label="t('granVideoEditor.projects.openLast', 'Open Project')"
          @click="handleOpenProject(workspaceStore.lastProjectName!)"
        />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        <!-- Create New Project Card -->
        <div
          class="bg-ui-bg-elevated border border-ui-border rounded-xl p-6 flex flex-col gap-4 shadow-xl"
        >
          <h3 class="font-medium text-ui-text">
            {{ t('granVideoEditor.projects.newProject', 'New Project') }}
          </h3>
          <UInput
            v-model="newProjectName"
            :placeholder="t('granVideoEditor.projects.projectNamePlaceholder', 'Project Name')"
            @keyup.enter="createNewProject"
          />
          <UButton
            color="primary"
            variant="soft"
            class="justify-center mt-auto"
            :loading="workspaceStore.isLoading"
            :disabled="!newProjectName.trim()"
            :label="t('common.create', 'Create')"
            @click="createNewProject"
          />
        </div>

        <!-- Existing Projects -->
        <div
          v-for="project in workspaceStore.projects"
          :key="project"
          class="bg-ui-bg-elevated border border-ui-border rounded-xl p-6 flex flex-col hover:border-primary-500/50 hover:bg-ui-bg-accent transition-all cursor-pointer group shadow-lg"
          @click="handleOpenProject(project)"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-10 h-10 rounded-lg bg-ui-bg-accent flex items-center justify-center group-hover:bg-primary-500/10 transition-colors"
            >
              <UIcon
                name="i-heroicons-film"
                class="w-5 h-5 text-ui-text-muted group-hover:text-primary-400 transition-colors"
              />
            </div>
            <h3
              class="font-medium text-ui-text truncate group-hover:text-primary-300 transition-colors"
            >
              {{ project }}
            </h3>
          </div>
          <div class="mt-auto flex justify-end">
            <UButton
              size="sm"
              variant="ghost"
              color="primary"
              icon="i-heroicons-arrow-right"
              class="opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0"
              :label="t('common.open', 'Open')"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
