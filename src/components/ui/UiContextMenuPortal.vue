<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';

defineOptions({
  inheritAttrs: false,
});

interface MenuItem {
  label?: string;
  icon?: string;
  disabled?: boolean;
  onSelect?: () => void;
}

const props = withDefaults(
  defineProps<{
    items: MenuItem[][];
    targetEl: HTMLElement | null;
    manual?: boolean;
  }>(),
  {
    manual: false,
  },
);

const isOpen = ref(false);
const menuX = ref(0);
const menuY = ref(0);
const menuEl = ref<HTMLElement | null>(null);

function open(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const target = props.targetEl;
  if (!target) return;

  const rect = target.getBoundingClientRect();
  menuX.value = e.clientX - rect.left;
  menuY.value = e.clientY - rect.top;
  isOpen.value = true;

  void nextTick(() => {
    if (!menuEl.value) return;
    const mRect = menuEl.value.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    if (menuX.value + mRect.width > tRect.width) {
      menuX.value = Math.max(0, tRect.width - mRect.width);
    }
    if (menuY.value + mRect.height > tRect.height) {
      menuY.value = Math.max(0, tRect.height - mRect.height);
    }
  });
}

function close() {
  isOpen.value = false;
}

function onGlobalPointerDown(e: PointerEvent) {
  if (menuEl.value && !menuEl.value.contains(e.target as Node)) {
    close();
  }
}

function onWindowBlur() {
  close();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

function onScroll() {
  close();
}

function onContextMenu(e: MouseEvent) {
  open(e);
}

watch(
  () => props.targetEl,
  (el, prev) => {
    if (props.manual) return;
    prev?.removeEventListener('contextmenu', onContextMenu);
    el?.addEventListener('contextmenu', onContextMenu);
  },
  { immediate: true },
);

onUnmounted(() => {
  props.targetEl?.removeEventListener('contextmenu', onContextMenu);
  window.removeEventListener('pointerdown', onGlobalPointerDown, { capture: true });
  window.removeEventListener('blur', onWindowBlur);
  window.removeEventListener('keydown', onKeyDown, { capture: true });
  window.removeEventListener('scroll', onScroll, { capture: true });
});

onMounted(() => {
  window.addEventListener('pointerdown', onGlobalPointerDown, { capture: true });
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('scroll', onScroll, { capture: true });
});

defineExpose({ open, close });
</script>

<template>
  <Teleport v-if="targetEl && isOpen" :to="targetEl">
    <div
      ref="menuEl"
      class="absolute z-99999 min-w-40 rounded-md border border-ui-border bg-ui-bg shadow-lg py-1 select-none"
      :style="{ left: `${menuX}px`, top: `${menuY}px` }"
    >
      <template v-for="(group, gi) in items" :key="gi">
        <div v-if="gi > 0" class="my-1 h-px bg-ui-border" />
        <button
          v-for="(item, ii) in group"
          :key="ii"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-ui-text hover:bg-ui-bg-elevated disabled:opacity-50 disabled:pointer-events-none"
          :disabled="item.disabled"
          @click="
            item.onSelect?.();
            close();
          "
        >
          <UIcon v-if="item.icon" :name="item.icon" class="w-4 h-4 shrink-0 text-ui-text-muted" />
          <span>{{ item.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
