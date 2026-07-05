<script setup lang="ts">
/**
 * Compact keyframe transport for the properties panel: jump to the previous /
 * next keyframe and add/remove a keyframe at the playhead (the centre diamond
 * is filled when the playhead sits on a keyframe). Mirrors the After
 * Effects / Premiere keyframe navigator. Shown only when the clip has at least
 * one animated parameter.
 */
const props = defineProps<{
  isOnKeyframe: boolean;
  canPaste?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  prev: [];
  next: [];
  toggle: [];
  copy: [];
  paste: [];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="flex items-center gap-0.5">
    <button
      type="button"
      class="p-1 rounded text-ui-text-muted hover:text-ui-text hover:bg-ui-border-elevated disabled:opacity-40"
      :disabled="props.disabled"
      :title="t('fastcat.clip.animation.navPrev')"
      @click="emit('prev')"
    >
      <UIcon name="i-heroicons-chevron-left" class="w-3.5 h-3.5 block" />
    </button>
    <button
      type="button"
      class="p-1 rounded transition-colors flex items-center justify-center disabled:opacity-40"
      :class="
        props.isOnKeyframe
          ? 'text-amber-400 bg-amber-400/20'
          : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-border-elevated'
      "
      :disabled="props.disabled"
      :aria-pressed="props.isOnKeyframe"
      :title="
        props.isOnKeyframe
          ? t('fastcat.clip.animation.removeKeyframe')
          : t('fastcat.clip.animation.addKeyframe')
      "
      @click="emit('toggle')"
    >
      <svg
        viewBox="0 0 24 24"
        class="w-3 h-3 block"
        :class="props.isOnKeyframe ? 'fill-current' : ''"
      >
        <path
          d="M12 2L2 12l10 10 10-10L12 2z"
          :fill="props.isOnKeyframe ? 'currentColor' : 'none'"
          stroke="currentColor"
          stroke-width="2"
        />
      </svg>
    </button>
    <button
      type="button"
      class="p-1 rounded text-ui-text-muted hover:text-ui-text hover:bg-ui-border-elevated disabled:opacity-40"
      :disabled="props.disabled"
      :title="t('fastcat.clip.animation.navNext')"
      @click="emit('next')"
    >
      <UIcon name="i-heroicons-chevron-right" class="w-3.5 h-3.5 block" />
    </button>

    <div class="w-px h-4 bg-ui-border mx-0.5" />

    <button
      type="button"
      class="p-1 rounded text-ui-text-muted hover:text-ui-text hover:bg-ui-border-elevated disabled:opacity-40"
      :disabled="props.disabled || !props.isOnKeyframe"
      :title="t('fastcat.clip.animation.copyKeyframe')"
      @click="emit('copy')"
    >
      <UIcon name="i-heroicons-document-duplicate" class="w-3.5 h-3.5 block" />
    </button>
    <button
      type="button"
      class="p-1 rounded text-ui-text-muted hover:text-ui-text hover:bg-ui-border-elevated disabled:opacity-40"
      :disabled="props.disabled || !props.canPaste"
      :title="t('fastcat.clip.animation.pasteKeyframe')"
      @click="emit('paste')"
    >
      <UIcon name="i-heroicons-clipboard" class="w-3.5 h-3.5 block" />
    </button>
  </div>
</template>
