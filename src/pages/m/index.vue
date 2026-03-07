<script setup lang="ts">
import { ref } from 'vue'
import { useWorkspaceStore } from '~/stores/workspace.store'
import { useProjectStore } from '~/stores/project.store'
import { useProjectActions } from '~/composables/editor/useProjectActions'

definePageMeta({
  layout: 'mobile'
})

const { t } = useI18n()
const workspaceStore = useWorkspaceStore()
const projectStore = useProjectStore()
const { openProject } = useProjectActions()
const router = useRouter()

const newProjectName = ref('')

async function createNewProject() {
  if (!newProjectName.value.trim()) return
  await projectStore.createProject(newProjectName.value.trim())
  if (workspaceStore.userSettings.openLastProjectOnStart) {
    await openProject(newProjectName.value.trim())
    projectStore.goToCut()
    router.push('/m/edit')
  }
  newProjectName.value = ''
}

async function handleOpenProject(project: string) {
  await openProject(project)
  projectStore.goToCut()
  router.push('/m/edit')
}
</script>

<template>
  <div class="p-4 flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Projects</h1>
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="lucide:monitor"
        to="/"
        label="Desktop"
      />
    </div>

    <!-- Workspace Info -->
    <div v-if="workspaceStore.workspaceHandle" class="text-sm text-slate-400">
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

    <!-- Create Project -->
    <div class="bg-slate-900 rounded-xl p-4 border border-slate-800">
      <h3 class="font-medium mb-3">New Project</h3>
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
    <div class="space-y-3">
      <h3 class="font-medium text-slate-400">Recent Projects</h3>
      <div
        v-for="project in workspaceStore.projects"
        :key="project"
        class="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between active:bg-slate-800 transition-colors"
        @click="handleOpenProject(project)"
      >
        <div class="flex items-center gap-3">
          <Icon name="lucide:film" class="w-5 h-5 text-slate-400" />
          <span class="font-medium">{{ project }}</span>
        </div>
        <Icon name="lucide:chevron-right" class="w-5 h-5 text-slate-500" />
      </div>

      <div v-if="workspaceStore.projects.length === 0" class="text-center py-8 text-slate-500">
        No projects found
      </div>
    </div>
  </div>
</template>
