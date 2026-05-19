import { inject, computed } from "vue";
export const fieldGroupInjectionKey = Symbol("nuxt-ui.field-group");
export function useFieldGroup(props) {
  const fieldGroup = inject(fieldGroupInjectionKey, void 0);
  return {
    orientation: computed(() => fieldGroup?.value.orientation),
    size: computed(() => props?.size ?? fieldGroup?.value.size)
  };
}
