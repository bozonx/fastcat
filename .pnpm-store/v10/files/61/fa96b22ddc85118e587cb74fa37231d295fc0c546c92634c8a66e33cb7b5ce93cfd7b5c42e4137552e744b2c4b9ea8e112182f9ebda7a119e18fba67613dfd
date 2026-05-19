import type { SwitchRootProps } from 'reka-ui';
import type { VNode } from 'vue';
import type { AppConfig } from '@nuxt/schema';
import theme from '#build/ui/switch';
import type { IconProps } from '../types';
import type { ButtonHTMLAttributes } from '../types/html';
import type { ComponentConfig } from '../types/tv';
type Switch = ComponentConfig<typeof theme, AppConfig, 'switch'>;
export interface SwitchProps extends Pick<SwitchRootProps, 'disabled' | 'id' | 'name' | 'required' | 'value' | 'defaultValue'>, /** @vue-ignore */ Omit<ButtonHTMLAttributes, 'type' | 'disabled' | 'name'> {
    /**
     * The element or component this component should render as.
     * @defaultValue 'div'
     */
    as?: any;
    /**
     * @defaultValue 'primary'
     */
    color?: Switch['variants']['color'];
    /**
     * @defaultValue 'md'
     */
    size?: Switch['variants']['size'];
    /** When `true`, the loading icon will be displayed. */
    loading?: boolean;
    /**
     * The icon when the `loading` prop is `true`.
     * @defaultValue appConfig.ui.icons.loading
     * @IconifyIcon
     */
    loadingIcon?: IconProps['name'];
    /**
     * Display an icon when the switch is checked.
     * @IconifyIcon
     */
    checkedIcon?: IconProps['name'];
    /**
     * Display an icon when the switch is unchecked.
     * @IconifyIcon
     */
    uncheckedIcon?: IconProps['name'];
    label?: string;
    description?: string;
    class?: any;
    ui?: Switch['slots'];
}
export type SwitchEmits = {
    change: [event: Event];
};
export interface SwitchSlots {
    label?(props: {
        label: string | undefined;
    }): VNode[];
    description?(props: {
        description: string | undefined;
    }): VNode[];
}
declare const _default: typeof __VLS_export;
export default _default;
declare const __VLS_export: __VLS_WithSlots<import("vue").DefineComponent<SwitchProps & {
    modelValue?: boolean;
}, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {
    change: (event: Event) => any;
    "update:modelValue": (value: boolean) => any;
}, string, import("vue").PublicProps, Readonly<SwitchProps & {
    modelValue?: boolean;
}> & Readonly<{
    onChange?: ((event: Event) => any) | undefined;
    "onUpdate:modelValue"?: ((value: boolean) => any) | undefined;
}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>, SwitchSlots>;
type __VLS_WithSlots<T, S> = T & {
    new (): {
        $slots: S;
    };
};
