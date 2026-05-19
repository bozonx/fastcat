<script>
import theme from "#build/ui/input-time";
</script>

<script setup>
import { computed, onMounted, ref } from "vue";
import { TimeFieldRoot, TimeFieldInput, useForwardPropsEmits } from "reka-ui";
import { reactiveOmit } from "@vueuse/core";
import { useAppConfig } from "#imports";
import { useComponentUI } from "../composables/useComponentUI";
import { useFieldGroup } from "../composables/useFieldGroup";
import { useComponentIcons } from "../composables/useComponentIcons";
import { useFormField } from "../composables/useFormField";
import { tv } from "../utils/tv";
import UIcon from "./Icon.vue";
import UAvatar from "./Avatar.vue";
const props = defineProps({
  as: { type: null, required: false },
  color: { type: null, required: false },
  variant: { type: null, required: false },
  size: { type: null, required: false },
  highlight: { type: Boolean, required: false },
  fixed: { type: Boolean, required: false },
  autofocus: { type: Boolean, required: false },
  autofocusDelay: { type: Number, required: false, default: 0 },
  class: { type: null, required: false },
  ui: { type: Object, required: false },
  defaultValue: { type: Object, required: false },
  defaultPlaceholder: { type: Object, required: false },
  placeholder: { type: Object, required: false },
  modelValue: { type: [Object, null], required: false },
  hourCycle: { type: null, required: false },
  step: { type: Object, required: false },
  stepSnapping: { type: Boolean, required: false },
  granularity: { type: String, required: false },
  hideTimeZone: { type: Boolean, required: false },
  maxValue: { type: Object, required: false },
  minValue: { type: Object, required: false },
  disabled: { type: Boolean, required: false },
  readonly: { type: Boolean, required: false },
  id: { type: String, required: false },
  name: { type: String, required: false },
  required: { type: Boolean, required: false },
  icon: { type: null, required: false },
  avatar: { type: Object, required: false },
  leading: { type: Boolean, required: false },
  leadingIcon: { type: null, required: false },
  trailing: { type: Boolean, required: false },
  trailingIcon: { type: null, required: false },
  loading: { type: Boolean, required: false },
  loadingIcon: { type: null, required: false }
});
const emits = defineEmits(["change", "blur", "focus", "update:modelValue", "update:placeholder"]);
const slots = defineSlots();
const appConfig = useAppConfig();
const uiProp = useComponentUI("inputTime", props);
const rootProps = useForwardPropsEmits(reactiveOmit(props, "id", "name", "color", "variant", "size", "highlight", "fixed", "disabled", "autofocus", "autofocusDelay", "icon", "avatar", "leading", "leadingIcon", "trailing", "trailingIcon", "loading", "loadingIcon", "class", "ui"), emits);
const { emitFormBlur, emitFormFocus, emitFormChange, emitFormInput, id, color, size: formGroupSize, name, highlight, disabled, ariaAttrs } = useFormField(props);
const { orientation, size: fieldGroupSize } = useFieldGroup(props);
const { isLeading, isTrailing, leadingIconName, trailingIconName } = useComponentIcons(props);
const inputSize = computed(() => fieldGroupSize.value || formGroupSize.value);
const ui = computed(() => tv({ extend: tv(theme), ...appConfig.ui?.inputTime || {} })({
  color: color.value,
  variant: props.variant,
  size: inputSize.value,
  loading: props.loading,
  highlight: highlight.value,
  fixed: props.fixed,
  leading: isLeading.value || !!props.avatar || !!slots.leading,
  trailing: isTrailing.value || !!slots.trailing,
  fieldGroup: orientation.value
}));
const inputsRef = ref([]);
function setInputRef(index, el) {
  inputsRef.value[index] = el;
}
function onUpdate(value) {
  const event = new Event("change", { target: { value } });
  emits("change", event);
  emitFormChange();
  emitFormInput();
}
function onBlur(event) {
  emitFormBlur();
  emits("blur", event);
}
function onFocus(event) {
  emitFormFocus();
  emits("focus", event);
}
function autoFocus() {
  if (props.autofocus) {
    inputsRef.value[0]?.$el?.focus();
  }
}
onMounted(() => {
  setTimeout(() => {
    autoFocus();
  }, props.autofocusDelay);
});
defineExpose({
  inputsRef
});
</script>

<template>
  <TimeFieldRoot
    v-bind="{ ...rootProps, ...ariaAttrs }"
    :id="id"
    v-slot="{ segments }"
    :name="name"
    :disabled="disabled"
    data-slot="base"
    :class="ui.base({ class: [uiProp?.base, props.class] })"
    @update:model-value="onUpdate"
    @blur="onBlur"
    @focus="onFocus"
  >
    <TimeFieldInput
      v-for="(segment, index) in segments"
      :key="`${segment.part}-${index}`"
      :ref="(el) => setInputRef(index, el)"
      :part="segment.part"
      data-slot="segment"
      :class="ui.segment({ class: uiProp?.segment })"
    >
      {{ segment.value.trim() }}
    </TimeFieldInput>

    <slot :ui="ui" />

    <span v-if="isLeading || !!avatar || !!slots.leading" data-slot="leading" :class="ui.leading({ class: uiProp?.leading })">
      <slot name="leading" :ui="ui">
        <UIcon v-if="isLeading && leadingIconName" :name="leadingIconName" data-slot="leadingIcon" :class="ui.leadingIcon({ class: uiProp?.leadingIcon })" />
        <UAvatar v-else-if="!!avatar" :size="uiProp?.leadingAvatarSize || ui.leadingAvatarSize()" v-bind="avatar" data-slot="leadingAvatar" :class="ui.leadingAvatar({ class: uiProp?.leadingAvatar })" />
      </slot>
    </span>

    <span v-if="isTrailing || !!slots.trailing" data-slot="trailing" :class="ui.trailing({ class: uiProp?.trailing })">
      <slot name="trailing" :ui="ui">
        <UIcon v-if="trailingIconName" :name="trailingIconName" data-slot="trailingIcon" :class="ui.trailingIcon({ class: uiProp?.trailingIcon })" />
      </slot>
    </span>
  </TimeFieldRoot>
</template>
