<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useWorkspaceStore } from '~/stores/workspace.store'
import { useProjectStore } from '~/stores/project.store'
import { useProjectActions } from '~/composables/editor/useProjectActions'

definePageMeta({
  layout: 'mobile'
})

const { t } = useI18n()
const workspaceStore = useWorkspaceStore()
const projectStore = useProjectStore()
const { openProject, resetProjectState } = useProjectActions()
const router = useRouter()

// Локальная копия последнего проекта для отображения предложения,
// так как из глобального стора мы его удалим
const suggestedProject = ref<string | null>(workspaceStore.lastProjectName)

// Сбрасываем состояние открытого проекта
resetProjectState()

onMounted(() => {
  // Удаляем из local storage id открытого проекта, как просил пользователь
  workspaceStore.lastProjectName = null
})

const newProjectName = ref('')

async function createNewProject() {
  if (!newProjectName.value.trim()) return
  await projectStore.createProject(newProjectName.value.trim())
  if (workspaceStore.userSettings.openLastProjectOnStart) {
    await openProject(newProjectName.value.trim())
    projectStore.goToCut()
    router.push('/m/editor')
  }
  newProjectName.value = ''
}

async function handleOpenProject(project: string) {
  await openProject(project)
  projectStore.goToCut()
  router.push('/m/editor')
}
</script>

<template>
  <div class="p-4 flex flex-col gap-6 bg-slate-950 min-h-screen">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-white">Projects</h1>
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="lucide:monitor"
        to="/?mode=desktop"
        label="Desktop"
      />
    </div>

    <!-- Workspace Info -->
    <div v-if="workspaceStore.workspaceHandle" class="text-sm text-slate-400 -mt-4">
      Workspace: {{ workspaceStore.workspaceHandle.name }}
      <UButton
        size="xs"
        variant="link"
        color="primary"
        class="ml-2"
        @click="workspaceStore.resetWorkspace"
      >
        Change
      </UButton>
    </div>

    <!-- Last Project Suggestion -->
    <div
      v-if="suggestedProject && workspaceStore.projects.includes(suggestedProject)"
      class="bg-blue-600/20 border border-blue-500/30 rounded-xl p-5 flex flex-col gap-3 shadow-lg shadow-blue-500/5 animate-in fade-in slide-in-from-top-2 duration-500"
    >
      <div class="flex flex-col">
        <span class="text-blue-400 text-[10px] font-bold uppercase tracking-widest">Continue Working</span>
        <h2 class="text-xl font-bold text-white truncate">{{ suggestedProject }}</h2>
      </div>
      <UButton
        block
        color="primary"
        icon="lucide:play"
        @click="handleOpenProject(suggestedProject!)"
      >
        Open Last Project
      </UButton>
    </div>

    <!-- Create Project -->
    <div class="bg-slate-900 rounded-xl p-4 border border-slate-800 shadow-xl">
      <h3 class="font-medium mb-3 text-slate-300">New Project</h3>
      <div class="flex gap-2">
        <UInput
          v-model="newProjectName"
          placeholder="Project Name"
          class="flex-1"
          @keyup.enter="createNewProject"
        />
        <UButton
          color="primary"
          :loading="workspaceStore.isLoading"
          :disabled="!newProjectName.trim()"
          @click="createNewProject"
        >
          Create
        </UButton>
      </div>
    </div>

    <div v-if="workspaceStore.error" class="text-red-400 text-sm">
      {{ workspaceStore.error }}
    </div>

    <!-- Project List -->
    <div class="space-y-4 flex-1">
      <h3 class="font-medium text-slate-400 flex items-center justify-between px-1">
        Recent Projects
        <span class="text-xs font-normal tabular-nums bg-slate-800 px-2 py-0.5 rounded-full">{{ workspaceStore.projects.length }}</span>
      </h3>
      
      <div v-if="workspaceStore.projects.length > 0" class="grid grid-cols-1 gap-3">
        <div
          v-for="project in workspaceStore.projects"
          :key="project"
          class="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex items-center justify-between active:bg-slate-800 active:scale-[0.98] transition-all shadow-sm"
          @click="handleOpenProject(project)"
        >
          <div class="flex items-center gap-3 overflow-hidden">
            <div class="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
              <Icon name="lucide:film" class="w-5 h-5 text-blue-400" />
            </div>
            <span class="font-medium text-slate-200 truncate">{{ project }}</span>
          </div>
          <Icon name="lucide:chevron-right" class="w-5 h-5 text-slate-600 shrink-0" />
        </div>
      </div>

      <div v-else class="flex flex-col items-center justify-center py-16 text-slate-500 gap-4">
        <div class="w-20 h-20 rounded-full bg-slate-900 flex items-center justify-center">
          <Icon name="lucide:folder-open" class="w-10 h-10 opacity-20" />
        </div>
        <div class="text-center">
          <p class="font-medium">No projects found</p>
          <p class="text-sm opacity-60">Create your first project above</p>
        </div>
      </div>
    </div>
  </div>
</template>
