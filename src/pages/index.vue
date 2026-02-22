<script setup lang="ts">
import { ref } from 'vue'
import TimelineExportModal from '~/components/TimelineExportModal.vue'
import EditorSettingsModal from '~/components/EditorSettingsModal.vue'
import { useWorkspaceStore } from '~/stores/workspace.store'
import { useProjectStore } from '~/stores/project.store'
import { useTimelineStore } from '~/stores/timeline.store'
import { useUiStore } from '~/stores/ui.store'

const { t } = useI18n()
const workspaceStore = useWorkspaceStore()
const projectStore = useProjectStore()
const timelineStore = useTimelineStore()
const uiStore = useUiStore()

const isExportModalOpen = ref(false)
const isEditorSettingsOpen = ref(false)



useHead({
  title: t('navigation.granVideoEditor'),
})

const newProjectName = ref('')
const isStartingUp = ref(true)

onMounted(async () => {
  try {
    await workspaceStore.init()

    if (
      workspaceStore.workspaceHandle &&
      workspaceStore.userSettings.openBehavior === 'open_last_project' &&
      workspaceStore.lastProjectName &&
      workspaceStore.projects.includes(workspaceStore.lastProjectName)
    ) {
      await projectStore.openProject(workspaceStore.lastProjectName)
      uiStore.restoreFileTreeStateOnce(workspaceStore.lastProjectName)
      await timelineStore.loadTimeline()
      void timelineStore.loadTimelineMetadata()
    }
  } finally {
    isStartingUp.value = false
  }
})

async function createNewProject() {
  if (!newProjectName.value.trim()) return
  await projectStore.createProject(newProjectName.value.trim())
  if (workspaceStore.userSettings.openBehavior === 'open_last_project') {
    await projectStore.openProject(newProjectName.value.trim())
    await timelineStore.loadTimeline()
    void timelineStore.loadTimelineMetadata()
  }
  newProjectName.value = ''
}
</script>

<template>
  <div class="flex flex-col h-screen w-screen overflow-hidden bg-gray-950 text-gray-200">

    <!-- Loading Screen -->
    <div 
      v-if="isStartingUp" 
      class="flex flex-col items-center justify-center flex-1 bg-gray-950"
    >
      <UIcon name="i-heroicons-arrow-path" class="w-10 h-10 text-indigo-500 shrink-0 animate-spin" />
      <span class="mt-4 text-gray-400 font-medium tracking-wide animate-pulse">
        {{ t('common.loading', 'Loading...') }}
      </span>
    </div>
    
    <!-- Welcome / Select Folder Screen -->
    <div 
      v-else-if="!workspaceStore.workspaceHandle" 
      class="flex flex-col items-center justify-center flex-1 bg-linear-to-br from-indigo-900 via-gray-900 to-black p-6"
    >
      <div class="max-w-md w-full text-center space-y-6 bg-gray-900/50 p-8 rounded-2xl backdrop-blur-sm border border-gray-700/50 shadow-2xl">
        <div class="mx-auto w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mb-6">
          <UIcon name="i-heroicons-film" class="w-8 h-8 text-indigo-400" />
        </div>
        
        <h1 class="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-indigo-300 to-purple-300">
          Gran Video Editor
        </h1>
        
        <p class="text-gray-400">
          {{ t('granVideoEditor.welcome.selectFolder', 'Select a workspace folder on your computer. This folder will store all your project files, media proxies, and cache.') }}
        </p>
        
        <div v-if="workspaceStore.error" class="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">
          {{ workspaceStore.error }}
        </div>
        
        <UButton
          v-if="workspaceStore.isApiSupported"
          size="lg"
          variant="solid"
          color="primary"
          icon="i-heroicons-folder-open"
          class="w-full justify-center transition-all hover:scale-[1.02]"
          :label="t('granVideoEditor.welcome.openWorkspace', 'Select Workspace Folder')"
          :loading="workspaceStore.isLoading"
          @click="workspaceStore.openWorkspace"
        />
        <div v-else class="text-orange-400 text-sm">
          {{ t('granVideoEditor.fileManager.unsupported', 'File System Access API is not supported in this browser') }}
        </div>
      </div>
    </div>

    <!-- Projects List Screen -->
    <div 
      v-else-if="!projectStore.currentProjectName" 
      class="flex flex-col flex-1 bg-gray-950 p-8 overflow-y-auto"
    >
      <div class="max-w-5xl w-full mx-auto space-y-8 pb-12">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold text-white">{{ t('granVideoEditor.projects.title', 'Projects') }}</h1>
            <p class="text-gray-400 text-sm mt-1">
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

        <div v-if="workspaceStore.error" class="text-red-400 text-sm">
          {{ workspaceStore.error }}
        </div>

        <!-- Last Project Hero Section -->
        <div 
          v-if="workspaceStore.lastProjectName && workspaceStore.projects.includes(workspaceStore.lastProjectName)"
          class="bg-linear-to-r from-indigo-900/40 to-purple-900/40 border border-indigo-500/30 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6"
        >
          <div class="space-y-2">
            <span class="text-indigo-400 text-xs font-bold uppercase tracking-widest">
              {{ t('granVideoEditor.projects.continueWorking', 'Continue Working') }}
            </span>
            <h2 class="text-3xl font-bold text-white">{{ workspaceStore.lastProjectName }}</h2>
          </div>
          <UButton
            size="xl"
            color="primary"
            class="px-8 shadow-lg shadow-indigo-500/20"
            icon="i-heroicons-play"
            :label="t('granVideoEditor.projects.openLast', 'Open Project')"
            @click="() => {
              if (workspaceStore.lastProjectName) {
                projectStore.openProject(workspaceStore.lastProjectName)
                uiStore.restoreFileTreeStateOnce(workspaceStore.lastProjectName)
                timelineStore.loadTimeline()
                timelineStore.loadTimelineMetadata()
              }
            }"
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <!-- Create New Project Card -->
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-6 flex flex-col gap-4 shadow-xl">
            <h3 class="font-medium text-white">{{ t('granVideoEditor.projects.newProject', 'New Project') }}</h3>
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
            class="bg-gray-900 border border-gray-800 rounded-xl p-6 flex flex-col hover:border-indigo-500/50 hover:bg-gray-800/80 transition-all cursor-pointer group shadow-lg"
            @click="() => {
              projectStore.openProject(project)
              uiStore.restoreFileTreeStateOnce(project)
              timelineStore.loadTimeline()
              timelineStore.loadTimelineMetadata()
            }"
          >
            <div class="flex items-center gap-3 mb-4">
              <div class="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center group-hover:bg-indigo-500/10 transition-colors">
                <UIcon name="i-heroicons-film" class="w-5 h-5 text-gray-400 group-hover:text-indigo-400 transition-colors" />
              </div>
              <h3 class="font-medium text-white truncate group-hover:text-indigo-300 transition-colors">{{ project }}</h3>
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

    <!-- Editor Screen -->
    <template v-else>
      <div class="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <div class="flex items-center gap-4">
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-arrow-left"
            @click="projectStore.currentProjectName = null"
          />
          <div class="flex items-center gap-2">
            <span class="text-gray-400 font-medium text-sm">{{ projectStore.currentProjectName }}</span>
            <span class="text-gray-600">/</span>
            <span class="text-white font-medium text-sm flex items-center gap-1">
              <UIcon name="i-heroicons-document" class="w-4 h-4 text-gray-500" />
              {{ projectStore.currentFileName }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-cog-6-tooth"
            :title="t('videoEditor.settings.title', 'Editor settings')"
            @click="isEditorSettingsOpen = true"
          />
          <UButton
            size="xs"
            variant="soft"
            color="primary"
            icon="i-heroicons-arrow-down-tray"
            :disabled="timelineStore.duration <= 0"
            :label="t('videoEditor.export.confirm', 'Export')"
            @click="isExportModalOpen = true"
          />
        </div>
      </div>

      <!-- Top half: File Manager + Preview + Monitor -->
      <div class="grid grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(0,3fr)_minmax(0,4fr)] flex-1 min-h-0 border-b border-gray-800">
        <FileManager />
        <Preview />
        <Monitor />
      </div>

      <!-- Bottom half: Timeline -->
      <div class="flex-1 min-h-0">
        <Timeline />
      </div>

      <TimelineExportModal
        v-model:open="isExportModalOpen"
        @exported="() => {}"
      />

      <EditorSettingsModal
        v-model:open="isEditorSettingsOpen"
      />
    </template>
  </div>
</template>
