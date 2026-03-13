#!/bin/bash

# Remove unused imports and unneeded variables in FileBrowser
sed -i '/import CreateFolderModal/d' src/components/file-manager/FileBrowser.vue
sed -i '/import RenameModal/d' src/components/file-manager/FileBrowser.vue
sed -i '/isCreateFolderModalOpen,/d' src/components/file-manager/FileBrowser.vue
sed -i '/isRenameModalOpen,/d' src/components/file-manager/FileBrowser.vue
sed -i '/folderCreationTarget,/d' src/components/file-manager/FileBrowser.vue
sed -i '/renameTarget,/d' src/components/file-manager/FileBrowser.vue
sed -i '/handleCreateFolder,/d' src/components/file-manager/FileBrowser.vue
sed -i '/handleRename,/d' src/components/file-manager/FileBrowser.vue
sed -i '/openCreateFolderModal,/d' src/components/file-manager/FileBrowser.vue
sed -i '/<CreateFolderModal/d' src/components/file-manager/FileBrowser.vue
sed -i '/<RenameModal/d' src/components/file-manager/FileBrowser.vue
sed -i '/v-model:open="isRenameModalOpen"/d' src/components/file-manager/FileBrowser.vue
sed -i '/:initial-name="renameTarget/d' src/components/file-manager/FileBrowser.vue
sed -i '/@rename="handleRename"/d' src/components/file-manager/FileBrowser.vue
sed -i '/@create="handleCreateFolder"/d' src/components/file-manager/FileBrowser.vue

# Same for ProjectFiles
sed -i '/import CreateFolderModal/d' src/components/project/ProjectFiles.vue
sed -i '/import RenameModal/d' src/components/project/ProjectFiles.vue
sed -i '/isCreateFolderModalOpen,/d' src/components/project/ProjectFiles.vue
sed -i '/isRenameModalOpen,/d' src/components/project/ProjectFiles.vue
sed -i '/folderCreationTarget,/d' src/components/project/ProjectFiles.vue
sed -i '/renameTarget,/d' src/components/project/ProjectFiles.vue
sed -i '/handleCreateFolder,/d' src/components/project/ProjectFiles.vue
sed -i '/handleRename,/d' src/components/project/ProjectFiles.vue
sed -i '/openCreateFolderModal,/d' src/components/project/ProjectFiles.vue
