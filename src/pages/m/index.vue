<script setup lang="ts">
import { tryDetectMediaDimensions } from '~/utils/projectMediaDetection';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import {
  useProjectManagement,
  usePendingNewProjectFiles,
} from '~/composables/project/useProjectManagement';
import { useProjectStore } from '~/stores/project.store';
import { onMounted, ref } from 'vue';
import { writeLocalStorageString, STORAGE_KEYS } from '~/stores/ui/uiLocalStorage';
import WelcomeScreen from '~/components/startup/WelcomeScreen.vue';
import { dropdownNoReturnFocus } from '~/composables/useDropdownMenuFocus';
import UiSearchInput from '~/components/ui/UiSearchInput.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import ProjectThumbnail from '~/components/startup/ProjectThumbnail.vue';
import MobileSettingsView from '~/components/settings/MobileSettingsView.vue';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import MobileBottomNav from '~/components/layout/MobileBottomNav.vue';
import FriendlyTime from '~/components/ui/FriendlyTime.vue';

definePageMeta({
  layout: 'mobile',
});

const { t, locale: _locale } = useI18n();
const router = useRouter();
const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const { resetProjectState } = useProjectActions();
const { pendingFilesForNewProject } = usePendingNewProjectFiles();

// Сбрасываем состояние открытого проекта при попадании на список
resetProjectState();

onMounted(() => {
  writeLocalStorageString(STORAGE_KEYS.APP.PREFER_DESKTOP, 'false');
});

const {
  searchQuery,
  renameValue,
  isCreateModalOpen,
  isTransitioning,
  projectCreationSettings,
  filteredProjects,
  isRenameModalOpen,
  isDeleteModalOpen,
  isDuplicateModalOpen,
  duplicateValue,
  createError,
  isCreateNameValid,
  renameError,
  isRenameNameValid,
  duplicateError,
  isDuplicateNameValid,
  createNewProject,
  handleOpenProject,
  renameProject,
  startRename,
  startDelete,
  confirmDelete,
  closeDeleteModal,
  startDuplicate,
  confirmDuplicate,
  closeDuplicateModal,
} = useProjectManagement({ isMobile: true });

const newProjectFileInput = ref<HTMLInputElement | null>(null);

function triggerNewProjectSelection() {
  newProjectFileInput.value?.click();
}

async function onNewProjectFilesSelected(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;

  const files = Array.from(target.files);
  target.value = '';

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const projectName = `Project ${dateStr}`;

  pendingFilesForNewProject.value = files;

  // Автоопределение параметров на основе первого видео или изображения
  const detected = await tryDetectMediaDimensions(files);

  const options = {
    width: detected?.width ?? 1920,
    height: detected?.height ?? 1080,
    fps: 30,
    resolutionFormat: detected?.resolutionFormat ?? '1080p',
    orientation: detected?.orientation ?? ('landscape' as const),
    aspectRatio: detected?.aspectRatio ?? '16:9',
    isCustomResolution: false,
    sampleRate: 48000,
    parentPath:
      workspaceStore.workspaceProviderId === 'tauri'
        ? projectCreationSettings.value.location
        : undefined,
  };

  try {
    await projectStore.createProject(projectName, options);
    if (workspaceStore.error) {
      pendingFilesForNewProject.value = [];
      return;
    }

    const url = `/m/editor/${encodeURIComponent(projectName)}?view=edit`;
    router.push(url);
  } catch (error) {
    pendingFilesForNewProject.value = [];
    // eslint-disable-next-line no-console
    console.error('Failed to create project with files:', error);
  }
}

const isSettingsOpen = ref(false);

// Сортировка для основного списка по дате изменения (сначала новые)
const sortedProjects = computed(() => {
  if (workspaceStore.workspaceProviderId === 'tauri') {
    const query = searchQuery.value.trim().toLowerCase();
    const projects = workspaceStore.recentProjects
      .filter((project) => !query || project.projectName.toLowerCase().includes(query))
      .map((project) => ({
        projectName: project.projectName,
        projectId: project.projectId,
        lastTimelinePath: project.lastTimelinePath,
        updatedAt: project.updatedAt,
        projectPath: project.projectPath,
      }));

    projects.sort((a, b) => {
      const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      if (dateA === dateB) {
        return a.projectName.localeCompare(b.projectName);
      }
      return dateB - dateA;
    });

    return projects;
  }

  const recentMap = new Map(workspaceStore.recentProjects.map((p) => [p.projectName, p]));
  const projects = filteredProjects.value.map((name) => {
    const recent = recentMap.get(name);
    return {
      projectName: name,
      projectId: recent?.projectId,
      lastTimelinePath: recent?.lastTimelinePath,
      updatedAt: recent?.updatedAt,
      projectPath: recent?.projectPath,
    };
  });

  projects.sort((a, b) => {
    const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (dateA === dateB) {
      return a.projectName.localeCompare(b.projectName);
    }
    return dateB - dateA;
  });

  return projects;
});

// formatDate removed in favor of FriendlyTime component
</script>

<template>
  <div class="h-screen w-full">
    <input
      ref="newProjectFileInput"
      type="file"
      multiple
      accept="video/*,image/*"
      class="hidden"
      @change="onNewProjectFilesSelected"
    />
    <!-- Если идет инициализация или загрузка данных воркспейса -->
    <div
      v-if="workspaceStore.isInitializing || workspaceStore.isLoading || isTransitioning"
      class="flex h-full w-full items-center justify-center bg-ui-bg"
    >
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
    </div>

    <!-- Если рабочая область не выбрана -->
    <WelcomeScreen
      v-else-if="!workspaceStore.workspaceHandle && workspaceStore.workspaceProviderId !== 'tauri'"
    />

    <template v-else>
      <div
        class="flex h-screen w-full flex-col landscape:flex-row bg-ui-bg overflow-hidden text-ui-text font-sans"
      >
        <div class="flex flex-1 flex-col min-w-0 min-h-0">
          <!-- Sticky Header with Glass Effect -->
          <header
            class="shrink-0 pt-safe px-5 pb-4 bg-ui-bg/80 backdrop-blur-xl border-b border-white/5 z-20"
          >
            <div class="flex items-center justify-between h-14 gap-4">
              <div class="flex flex-col min-w-0 shrink-0">
                <h1 class="text-xl font-black tracking-tight text-white uppercase italic truncate">
                  FastCat <span class="text-primary-500 not-italic">Editor</span>
                </h1>
                <div
                  class="flex items-center gap-1 text-[10px] text-ui-text-muted font-bold uppercase tracking-widest"
                >
                  <UIcon name="i-heroicons-folder" class="w-3 h-3" />
                  <span class="truncate max-w-[120px]">{{
                    workspaceStore.workspaceProviderId === 'tauri'
                      ? t('fastcat.projects.localWorkspaceName')
                      : workspaceStore.workspaceHandle?.name
                  }}</span>
                </div>
              </div>

              <!-- Search Bar (landscape only) -->
              <div class="hidden landscape:flex flex-1 max-w-md min-w-0">
                <UiSearchInput
                  v-model="searchQuery"
                  :placeholder="t('fastcat.projects.searchPlaceholder')"
                  is-mobile
                />
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <!-- Action Buttons (landscape only) -->
                <UButton
                  size="md"
                  color="primary"
                  icon="i-heroicons-plus"
                  class="hidden landscape:flex shadow-lg shadow-ui-action/20 rounded-2xl font-bold uppercase tracking-wide bg-ui-action! hover:bg-ui-action-hover! text-white! border-none transition-all active:scale-[0.98]"
                  @click="triggerNewProjectSelection"
                >
                  {{ t('fastcat.projects.newProject') }}
                </UButton>

                <UButton
                  size="sm"
                  variant="ghost"
                  color="neutral"
                  icon="i-heroicons-computer-desktop"
                  class="rounded-full w-10 h-10 p-0 flex items-center justify-center bg-white/5 text-ui-text-muted"
                  @click="void router.push('/?mode=desktop')"
                />
                <UButton
                  size="sm"
                  variant="ghost"
                  color="neutral"
                  icon="i-heroicons-cog-6-tooth"
                  class="rounded-full w-10 h-10 p-0 flex items-center justify-center bg-white/5"
                  @click="void (isSettingsOpen = true)"
                />
              </div>
            </div>
          </header>

          <!-- Main Content -->
          <main class="flex-1 overflow-y-auto bg-ui-bg custom-scrollbar relative">
            <!-- 1. Completely Empty State (No projects at all) -->
            <div
              v-if="sortedProjects.length === 0 && !searchQuery"
              class="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center gap-6"
            >
              <div class="relative w-36 h-36 flex items-center justify-center">
                <div
                  class="absolute inset-0 bg-gradient-to-tr from-primary-500/20 to-selection-accent-500/10 rounded-full blur-2xl animate-pulse"
                />
                <div
                  class="w-24 h-24 rounded-3xl bg-ui-bg-elevated/80 border border-white/10 flex items-center justify-center shadow-2xl relative"
                >
                  <UIcon
                    name="i-heroicons-squares-plus"
                    class="w-12 h-12 text-primary-400 animate-pulse"
                  />
                </div>
              </div>
              <div class="space-y-2 max-w-sm">
                <h2 class="text-xl font-bold text-white tracking-tight">
                  {{ t('fastcat.projects.welcomeTitle') }}
                </h2>
                <p class="text-sm text-ui-text-muted">
                  {{ t('fastcat.projects.welcomeSubtitleMobile') }}
                </p>
              </div>
              <UButton
                size="xl"
                color="primary"
                icon="i-heroicons-plus"
                class="shadow-lg shadow-ui-action/20 py-4 px-8 rounded-2xl font-bold uppercase tracking-wide bg-ui-action! hover:bg-ui-action-hover! text-white! border-none transition-all active:scale-[0.98] mt-2 animate-bounce"
                @click="triggerNewProjectSelection"
              >
                {{ t('fastcat.projects.newProject') }}
              </UButton>
            </div>

            <!-- 2. Dashboard with Projects -->
            <template v-else>
              <!-- Search Bar Sticky below header (Mobile Portrait only) -->
              <div
                class="px-5 py-4 sticky top-0 z-10 bg-ui-bg/80 backdrop-blur-md border-b border-white/5 landscape:hidden"
              >
                <UiSearchInput
                  v-model="searchQuery"
                  :placeholder="t('fastcat.projects.searchPlaceholder')"
                  is-mobile
                />
              </div>

              <div class="flex flex-col gap-8 pb-24">
                <!-- New Project Button (Mobile Portrait only) -->
                <div class="flex flex-col gap-3 px-5 landscape:hidden">
                  <UButton
                    block
                    size="xl"
                    color="primary"
                    icon="i-heroicons-plus"
                    class="shadow-lg shadow-ui-action/20 py-4 rounded-2xl font-bold uppercase tracking-wide bg-ui-action! hover:bg-ui-action-hover! text-white! border-none transition-all active:scale-[0.98]"
                    @click="triggerNewProjectSelection"
                  >
                    {{ t('fastcat.projects.newProject') }}
                  </UButton>
                  <span
                    class="text-[11px] text-ui-text-muted/80 text-center block -mt-1 mb-1 font-medium"
                  >
                    {{ t('fastcat.projects.selectMediaHint') }}
                  </span>
                </div>

                <div class="px-5 pt-6 pb-24">
                  <!-- Если проекты есть -->
                  <div
                    v-if="sortedProjects.length > 0"
                    class="grid grid-cols-1 landscape:grid-cols-2 gap-4"
                  >
                    <UiSwipeableRow
                      v-for="project in sortedProjects"
                      :key="project.projectPath || project.projectId || project.projectName"
                      class="rounded-2xl overflow-hidden"
                    >
                      <template #actions="{ close }">
                        <div class="flex h-full items-stretch pl-2 pr-1 py-0">
                          <button
                            class="bg-blue-600 active:bg-blue-700 text-white w-14 rounded-2xl h-full flex items-center justify-center transition-colors cursor-pointer"
                            :aria-label="t('common.rename')"
                            @click.stop="
                              startRename(project);
                              close();
                            "
                          >
                            <UIcon name="i-heroicons-pencil-square" class="w-6 h-6" />
                          </button>
                          <button
                            class="bg-red-600 active:bg-red-700 text-white w-14 rounded-2xl h-full flex items-center justify-center transition-colors ml-1 cursor-pointer"
                            :aria-label="t('common.delete')"
                            @click.stop="
                              startDelete(project);
                              close();
                            "
                          >
                            <UIcon name="i-heroicons-trash" class="w-6 h-6" />
                          </button>
                        </div>
                      </template>

                      <div
                        class="group bg-ui-bg-elevated/40 border border-white/5 rounded-2xl overflow-hidden flex items-center active:bg-ui-bg-elevated transition-all shadow-sm h-20"
                        @click="handleOpenProject(project.projectPath || project.projectName)"
                      >
                        <div class="w-20 h-full relative shrink-0">
                          <ProjectThumbnail
                            :project-id="project.projectId"
                            :project-relative-path="project.lastTimelinePath"
                            :project-name="project.projectName"
                            variant="mobile"
                          />
                          <div class="absolute inset-0 bg-black/20" />
                        </div>

                        <div class="px-4 flex items-center justify-between flex-1 min-w-0 h-full">
                          <div class="flex flex-col min-w-0">
                            <span
                              class="font-bold text-ui-text truncate text-sm tracking-tight leading-tight"
                              >{{ project.projectName }}</span
                            >
                            <span
                              class="text-[10px] text-ui-text-muted font-medium flex items-center gap-1 mt-1"
                            >
                              <UIcon name="i-heroicons-clock" class="w-3 h-3" />
                              <FriendlyTime :date="project.updatedAt" fallback="---" />
                            </span>
                          </div>

                          <div class="flex items-center gap-2 shrink-0">
                            <UDropdownMenu
                              :items="[
                                [
                                  {
                                    label: t('common.rename'),
                                    icon: 'i-heroicons-pencil-square',
                                    onSelect: () => startRename(project),
                                  },
                                  {
                                    label: t('common.duplicate'),
                                    icon: 'i-heroicons-document-duplicate',
                                    onSelect: () => startDuplicate(project),
                                  },
                                  {
                                    label: t('common.delete'),
                                    icon: 'i-heroicons-trash',
                                    onSelect: () => startDelete(project),
                                  },
                                ],
                              ]"
                              :content="dropdownNoReturnFocus"
                            >
                              <UButton
                                size="sm"
                                variant="ghost"
                                color="neutral"
                                icon="i-heroicons-ellipsis-vertical-16-solid"
                                class="rounded-full w-9 h-9 p-0 text-ui-text-muted active:text-white active:bg-white/5 transition-colors"
                                @click.stop
                              />
                            </UDropdownMenu>
                          </div>
                        </div>
                      </div>
                    </UiSwipeableRow>
                  </div>

                  <!-- Если проектов нет -->
                  <div
                    v-else
                    class="flex flex-col items-center justify-center py-24 text-ui-text-muted gap-8"
                  >
                    <div
                      class="w-28 h-28 rounded-full bg-ui-bg-elevated/50 flex items-center justify-center border border-white/5 relative"
                    >
                      <UIcon name="i-heroicons-folder-open" class="w-12 h-12 opacity-10" />
                      <div class="absolute inset-0 bg-primary-500/5 rounded-full animate-pulse" />
                    </div>
                    <div class="text-center space-y-3">
                      <p
                        class="font-black uppercase tracking-[0.2em] text-[10px] text-ui-text-muted"
                      >
                        {{ t('fastcat.projects.noProjectsFound') }}
                      </p>
                      <UButton
                        variant="solid"
                        color="neutral"
                        size="sm"
                        class="rounded-full px-6 bg-ui-action! hover:bg-ui-action-hover! text-white! border-none shadow-ui-action/20"
                        :label="t('fastcat.projects.newProject')"
                        @click="triggerNewProjectSelection"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </main>
        </div>

        <!-- Bottom Navigation Bar -->
        <MobileBottomNav class="landscape:order-first" />

        <!-- Error Toast Overlay -->
        <div v-if="workspaceStore.error" class="fixed bottom-24 left-5 right-5 z-50 animate-bounce">
          <div
            class="bg-red-500/90 backdrop-blur-md text-white text-[11px] font-bold p-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-red-400/20"
          >
            <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5" />
            {{ workspaceStore.error }}
          </div>
        </div>
      </div>

      <!-- Create Project Modal (iOS Style Sheet) -->
      <UiMobileDrawer
        v-model:open="isCreateModalOpen"
        :title="t('fastcat.projects.newProject')"
        :dismissible="!workspaceStore.isLoading"
        :show-close="!workspaceStore.isLoading"
      >
        <div class="space-y-6 px-6 pt-2 pb-6">
          <UiFormField
            :label="t('fastcat.projects.projectNamePlaceholder')"
            :error="createError ? t(createError) : undefined"
          >
            <UiTextInput
              v-model="projectCreationSettings.name"
              :placeholder="t('fastcat.projects.projectNamePlaceholder')"
              variant="none"
              :disabled="workspaceStore.isLoading"
              full-width
              :ui="{
                base: 'h-16 text-xl font-bold px-6 bg-ui-bg-elevated/50 border border-white/5 rounded-3xl focus:ring-2 focus:ring-primary-500 transition-all placeholder:text-ui-text-muted',
              }"
              autofocus
              @keyup.enter="createNewProject"
            />
          </UiFormField>

          <div class="flex items-center justify-between gap-3">
            <span class="text-sm text-ui-text">
              {{ t('fastcat.projects.specifyProjectSettings') }}
            </span>
            <USwitch
              v-model="projectCreationSettings.specifyProjectSettings"
              :disabled="workspaceStore.isLoading"
            />
          </div>

          <UiAlert v-if="!projectCreationSettings.specifyProjectSettings">
            {{ t('fastcat.projects.autoDetectHint') }}
          </UiAlert>

          <div v-else class="pt-6 border-t border-white/5 mt-4 space-y-6">
            <MediaResolutionSettings
              v-model:width="projectCreationSettings.width"
              v-model:height="projectCreationSettings.height"
              v-model:fps="projectCreationSettings.fps"
              v-model:resolution-format="projectCreationSettings.resolutionFormat"
              v-model:orientation="projectCreationSettings.orientation"
              v-model:aspect-ratio="projectCreationSettings.aspectRatio"
              v-model:is-custom-resolution="projectCreationSettings.isCustomResolution"
              v-model:sample-rate="projectCreationSettings.sampleRate"
              :disabled="workspaceStore.isLoading"
            />
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end gap-3 w-full pb-safe">
            <UButton
              variant="ghost"
              color="neutral"
              :disabled="workspaceStore.isLoading"
              :label="t('common.cancel')"
              @click="void (isCreateModalOpen = false)"
            />
            <UButton
              color="success"
              :disabled="!isCreateNameValid"
              :label="t('common.create')"
              @click="createNewProject"
            />
          </div>
        </template>
      </UiMobileDrawer>

      <!-- Settings Drawer -->
      <UiMobileDrawer v-model:open="isSettingsOpen" :title="t('videoEditor.settings.title')">
        <MobileSettingsView hide-title />
      </UiMobileDrawer>

      <!-- Rename Project Drawer -->
      <UiMobileDrawer v-model:open="isRenameModalOpen" :title="t('common.rename')">
        <div class="space-y-6 px-6 pt-2 pb-6">
          <UiFormField
            :label="t('fastcat.projects.projectNamePlaceholder')"
            :error="renameError ? t(renameError) : undefined"
          >
            <UiTextInput
              v-model="renameValue"
              :placeholder="t('fastcat.projects.projectNamePlaceholder')"
              variant="none"
              full-width
              :ui="{
                base: 'h-16 text-xl font-bold px-6 bg-ui-bg-elevated/50 border border-white/5 rounded-3xl focus:ring-2 focus:ring-primary-500 transition-all placeholder:text-ui-text-muted',
              }"
              autofocus
              @keyup.enter="renameProject"
            />
          </UiFormField>
        </div>

        <template #footer>
          <div class="flex justify-end gap-3 w-full pb-safe">
            <UButton variant="ghost" color="neutral" @click="void (isRenameModalOpen = false)">
              {{ t('common.cancel') }}
            </UButton>
            <UButton color="primary" :disabled="!isRenameNameValid" @click="renameProject">
              {{ t('common.rename') }}
            </UButton>
          </div>
        </template>
      </UiMobileDrawer>

      <!-- Delete Project Confirmation Drawer -->
      <UiMobileDrawer
        v-model:open="isDeleteModalOpen"
        :title="t('videoEditor.projectSettings.deleteProjectConfirmTitle')"
      >
        <div class="space-y-4 px-6 pt-2 pb-6">
          <p class="text-sm text-ui-text-muted">
            {{ t('videoEditor.projectSettings.deleteProjectConfirmDescription') }}
          </p>
        </div>

        <template #footer>
          <div class="flex justify-end gap-3 w-full pb-safe">
            <UButton variant="ghost" color="neutral" @click="closeDeleteModal">
              {{ t('common.cancel') }}
            </UButton>
            <UButton
              color="error"
              :loading="workspaceStore.isLoading"
              data-primary-focus="true"
              @click="confirmDelete"
            >
              {{ t('videoEditor.projectSettings.deleteProjectAction') }}
            </UButton>
          </div>
        </template>
      </UiMobileDrawer>

      <!-- Duplicate Project Drawer -->
      <UiMobileDrawer v-model:open="isDuplicateModalOpen" :title="t('common.duplicate')">
        <div class="space-y-6 px-6 pt-2 pb-6">
          <UiFormField
            :label="t('fastcat.projects.projectNamePlaceholder')"
            :error="duplicateError ? t(duplicateError) : undefined"
          >
            <UiTextInput
              v-model="duplicateValue"
              :placeholder="t('fastcat.projects.projectNamePlaceholder')"
              variant="none"
              full-width
              :ui="{
                base: 'h-16 text-xl font-bold px-6 bg-ui-bg-elevated/50 border border-white/5 rounded-3xl focus:ring-2 focus:ring-primary-500 transition-all placeholder:text-ui-text-muted',
              }"
              autofocus
              @keyup.enter="confirmDuplicate"
            />
          </UiFormField>
        </div>

        <template #footer>
          <div class="flex justify-end gap-3 w-full pb-safe">
            <UButton variant="ghost" color="neutral" @click="closeDuplicateModal">
              {{ t('common.cancel') }}
            </UButton>
            <UButton color="primary" :disabled="!isDuplicateNameValid" @click="confirmDuplicate">
              {{ t('common.duplicate') }}
            </UButton>
          </div>
        </template>
      </UiMobileDrawer>
    </template>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 3px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
}
</style>
