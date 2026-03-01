<script setup lang="ts">
import { Splitpanes, Pane } from 'splitpanes';
</script>

<template>
  <ClientOnly>
    <Splitpanes class="flex-1 min-h-0 editor-splitpanes" horizontal>
      <Pane size="60" min-size="10">
        <Splitpanes class="editor-splitpanes">
          <Pane min-size="10">
            <div class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted">
              <h3 class="font-bold mb-2">Звук: Панель 1</h3>
            </div>
          </Pane>
          <Pane min-size="10">
            <div class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted">
              <h3 class="font-bold mb-2">Звук: Панель 2</h3>
            </div>
          </Pane>
        </Splitpanes>
      </Pane>
      <Pane size="40" min-size="10">
        <div class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted">
          <h3 class="font-bold mb-2">Звук: Таймлайн</h3>
        </div>
      </Pane>
    </Splitpanes>
  </ClientOnly>
</template>
