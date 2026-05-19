import type { CheckboxRootProps } from 'reka-ui';
import type { VNode } from 'vue';
import type { AppConfig } from '@nuxt/schema';
import theme from '#build/ui/checkbox';
import type { IconProps } from '../types';
import type { ButtonHTMLAttributes } from '../types/html';
import type { ComponentConfig } from '../types/tv';
type Checkbox = ComponentConfig<typeof theme, AppConfig, 'checkbox'>;
export interface CheckboxProps extends Pick<CheckboxRootProps, 'disabled' | 'required' | 'name' | 'value' | 'id' | 'defaultValue'>, /** @vue-ignore */ Omit<ButtonHTMLAttributes, 'type' | 'disabled' | 'name'> {
    /**
     * The element or component this component should render as.
     * @defaultValue 'div'
     */
    as?: any;
    label?: string;
    description?: string;
    /**
     * @defaultValue 'primary'
     */
    color?: Checkbox['variants']['color'];
    /**
     * @defaultValue 'list'
     */
    variant?: Checkbox['variants']['variant'];
    /**
     * @defaultValue 'md'
     */
    size?: Checkbox['variants']['size'];
    /**
     * Position of the indicator.
     * @defaultValue 'start'
     */
    indicator?: Checkbox['variants']['indicator'];
    /**
     * The icon displayed when checked.
     * @defaultValue appConfig.ui.icons.check
     * @IconifyIcon
     */
    icon?: IconProps['name'];
    /**
     * The icon displayed when the checkbox is indeterminate.
     * @defaultValue appConfig.ui.icons.minus
     * @IconifyIcon
     */
    indeterminateIcon?: IconProps['name'];
    class?: any;
    ui?: Checkbox['slots'];
}
export type CheckboxEmits = {
    change: [event: Event];
};
export interface CheckboxSlots {
    label?(props: {
        label: string | undefined;
    }): VNode[];
    description?(props: {
        description: string | undefined;
    }): VNode[];
}
declare const _default: typeof __VLS_export;
export default _default;
declare const __VLS_export: __VLS_WithSlots<import("vue").DefineComponent<CheckboxProps & {
    modelValue?: boolean | "indeterminate";
}, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {
    change: (event: Event) => any;
    "update:modelValue": (value: boolean | "indeterminate") => any;
}, string, import("vue").PublicProps, Readonly<CheckboxProps & {
    modelValue?: boolean | "indeterminate";
}> & Readonly<{
    onChange?: ((event: Event) => any) | undefined;
    "onUpdate:modelValue"?: ((value: boolean | "indeterminate") => any) | undefined;
}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>, CheckboxSlots>;
type __VLS_WithSlots<T, S> = T & {
    new (): {
        $slots: S;
    };
};
