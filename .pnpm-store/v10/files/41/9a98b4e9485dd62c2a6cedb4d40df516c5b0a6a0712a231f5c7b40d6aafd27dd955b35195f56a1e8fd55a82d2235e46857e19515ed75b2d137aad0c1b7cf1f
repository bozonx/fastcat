<script>
import theme from "#build/ui/checkbox";
</script>

<script setup>
import { computed, useAttrs, useId } from "vue";
import { Primitive, CheckboxRoot, CheckboxIndicator, Label, useForwardProps } from "reka-ui";
import { reactivePick } from "@vueuse/core";
import { useAppConfig } from "#imports";
import { useComponentUI } from "../composables/useComponentUI";
import { useFormField } from "../composables/useFormField";
import { tv } from "../utils/tv";
import UIcon from "./Icon.vue";
defineOptions({ inheritAttrs: false });
const props = defineProps({
  as: { type: null, required: false },
  label: { type: String, required: false },
  description: { type: String, required: false },
  color: { type: null, required: false },
  variant: { type: null, required: false },
  size: { type: null, required: false },
  indicator: { type: null, required: false },
  icon: { type: null, required: false },
  indeterminateIcon: { type: null, required: false },
  class: { type: null, required: false },
  ui: { type: Object, required: false },
  disabled: { type: Boolean, required: false },
  required: { type: Boolean, required: false },
  name: { type: String, required: false },
  value: { type: null, required: false },
  id: { type: String, required: false },
  defaultValue: { type: [Boolean, String], required: false }
});
const slots = defineSlots();
const emits = defineEmits(["change"]);
const modelValue = defineModel({ type: [Boolean, String], ...{ default: void 0 } });
const appConfig = useAppConfig();
const uiProp = useComponentUI("checkbox", props);
const rootProps = useForwardProps(reactivePick(props, "required", "value", "defaultValue"));
const { id: _id, emitFormChange, emitFormInput, size, color, name, disabled, ariaAttrs } = useFormField(props);
const id = _id.value ?? useId();
const attrs = useAttrs();
const forwardedAttrs = computed(() => {
  const { "data-state": _, ...rest } = attrs;
  return rest;
});
const ui = computed(() => tv({ extend: tv(theme), ...appConfig.ui?.checkbox || {} })({
  size: size.value,
  color: color.value,
  variant: props.variant,
  indicator: props.indicator,
  required: props.required,
  disabled: disabled.value
}));
function onUpdate(value) {
  const event = new Event("change", { target: { value } });
  emits("change", event);
  emitFormChange();
  emitFormInput();
}
</script>

<template>
  <Primitive :as="!variant || variant === 'list' ? as : Label" data-slot="root" :class="ui.root({ class: [uiProp?.root, props.class] })">
    <div data-slot="container" :class="ui.container({ class: uiProp?.container })">
      <CheckboxRoot
        :id="id"
        v-bind="{ ...rootProps, ...forwardedAttrs, ...ariaAttrs }"
        v-model="modelValue"
        :name="name"
        :disabled="disabled"
        data-slot="base"
        :class="ui.base({ class: uiProp?.base })"
        @update:model-value="onUpdate"
      >
        <template #default="{ modelValue }">
          <CheckboxIndicator data-slot="indicator" :class="ui.indicator({ class: uiProp?.indicator })">
            <UIcon v-if="modelValue === 'indeterminate'" :name="indeterminateIcon || appConfig.ui.icons.minus" data-slot="icon" :class="ui.icon({ class: uiProp?.icon })" />
            <UIcon v-else :name="icon || appConfig.ui.icons.check" data-slot="icon" :class="ui.icon({ class: uiProp?.icon })" />
          </CheckboxIndicator>
        </template>
      </CheckboxRoot>
    </div>

    <div v-if="label || !!slots.label || (description || !!slots.description)" data-slot="wrapper" :class="ui.wrapper({ class: uiProp?.wrapper })">
      <component :is="!variant || variant === 'list' ? Label : 'p'" v-if="label || !!slots.label" :for="id" data-slot="label" :class="ui.label({ class: uiProp?.label })">
        <slot name="label" :label="label">
          {{ label }}
        </slot>
      </component>
      <p v-if="description || !!slots.description" data-slot="description" :class="ui.description({ class: uiProp?.description })">
        <slot name="description" :description="description">
          {{ description }}
        </slot>
      </p>
    </div>
  </Primitive>
</template>
