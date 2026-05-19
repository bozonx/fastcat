import type { CalendarRootProps, CalendarRootEmits, RangeCalendarRootProps, RangeCalendarRootEmits, DateRange, CalendarCellTriggerProps } from 'reka-ui';
import type { VNode } from 'vue';
import type { DateValue } from '@internationalized/date';
import type { AppConfig } from '@nuxt/schema';
import theme from '#build/ui/calendar';
import type { ButtonProps, IconProps, LinkPropsKeys } from '../types';
import type { ComponentConfig } from '../types/tv';
type Calendar = ComponentConfig<typeof theme, AppConfig, 'calendar'>;
type CalendarDefaultValue<R extends boolean = false, M extends boolean = false> = R extends true ? DateRange : M extends true ? DateValue[] : DateValue;
type CalendarModelValue<R extends boolean = false, M extends boolean = false> = R extends true ? (DateRange | null) : M extends true ? (DateValue[] | undefined) : (DateValue | undefined);
type _CalendarRootProps = Omit<CalendarRootProps, 'as' | 'asChild' | 'modelValue' | 'defaultValue' | 'dir' | 'locale' | 'calendarLabel' | 'multiple'>;
type _RangeCalendarRootProps = Omit<RangeCalendarRootProps, 'as' | 'asChild' | 'modelValue' | 'defaultValue' | 'dir' | 'locale' | 'calendarLabel' | 'multiple'>;
export interface CalendarProps<R extends boolean = false, M extends boolean = false> extends _RangeCalendarRootProps, _CalendarRootProps {
    /**
     * The element or component this component should render as.
     * @defaultValue 'div'
     */
    as?: any;
    /**
     * The icon to use for the next year control.
     * @defaultValue appConfig.ui.icons.chevronDoubleRight
     * @IconifyIcon
     */
    nextYearIcon?: IconProps['name'];
    /**
     * Configure the next year button.
     * `{ color: 'neutral', variant: 'ghost' }`{lang="ts-type"}
     */
    nextYear?: Omit<ButtonProps, LinkPropsKeys>;
    /**
     * The icon to use for the next month control.
     * @defaultValue appConfig.ui.icons.chevronRight
     * @IconifyIcon
     */
    nextMonthIcon?: IconProps['name'];
    /**
     * Configure the next month button.
     * `{ color: 'neutral', variant: 'ghost' }`{lang="ts-type"}
     */
    nextMonth?: Omit<ButtonProps, LinkPropsKeys>;
    /**
     * The icon to use for the previous year control.
     * @defaultValue appConfig.ui.icons.chevronDoubleLeft
     * @IconifyIcon
     */
    prevYearIcon?: IconProps['name'];
    /**
     * Configure the prev year button.
     * `{ color: 'neutral', variant: 'ghost' }`{lang="ts-type"}
     */
    prevYear?: Omit<ButtonProps, LinkPropsKeys>;
    /**
     * The icon to use for the previous month control.
     * @defaultValue appConfig.ui.icons.chevronLeft
     * @IconifyIcon
     */
    prevMonthIcon?: IconProps['name'];
    /**
     * Configure the prev month button.
     * `{ color: 'neutral', variant: 'ghost' }`{lang="ts-type"}
     */
    prevMonth?: Omit<ButtonProps, LinkPropsKeys>;
    /**
     * @defaultValue 'primary'
     */
    color?: Calendar['variants']['color'];
    /**
     * @defaultValue 'solid'
     */
    variant?: Calendar['variants']['variant'];
    /**
     * @defaultValue 'md'
     */
    size?: Calendar['variants']['size'];
    /** Whether or not a range of dates can be selected */
    range?: R & boolean;
    /** Whether or not multiple dates can be selected */
    multiple?: M & boolean;
    /** Show month controls */
    monthControls?: boolean;
    /** Show year controls */
    yearControls?: boolean;
    defaultValue?: CalendarDefaultValue<R, M>;
    modelValue?: CalendarModelValue<R, M>;
    weekNumbers?: boolean;
    class?: any;
    ui?: Calendar['slots'];
}
export interface CalendarEmits<R extends boolean, M extends boolean> extends Omit<CalendarRootEmits & RangeCalendarRootEmits, 'update:modelValue'> {
    'update:modelValue': [date: CalendarModelValue<R, M>];
}
export interface CalendarSlots {
    'heading'?: (props: {
        value: string;
    }) => VNode[];
    'day'?: (props: Pick<CalendarCellTriggerProps, 'day'>) => VNode[];
    'week-day'?: (props: {
        day: string;
    }) => VNode[];
}
declare const _default: typeof __VLS_export;
export default _default;
declare const __VLS_export: <R extends boolean, M extends boolean>(__VLS_props: NonNullable<Awaited<typeof __VLS_setup>>["props"], __VLS_ctx?: __VLS_PrettifyLocal<Pick<NonNullable<Awaited<typeof __VLS_setup>>, "attrs" | "emit" | "slots">>, __VLS_exposed?: NonNullable<Awaited<typeof __VLS_setup>>["expose"], __VLS_setup?: Promise<{
    props: import("vue").PublicProps & __VLS_PrettifyLocal<CalendarProps<R, M> & {
        "onUpdate:modelValue"?: ((date: CalendarModelValue<R, M>) => any) | undefined;
        "onUpdate:placeholder"?: ((...args: DateValue[]) => any) | undefined;
        "onUpdate:validModelValue"?: ((date: DateRange) => any) | undefined;
        "onUpdate:startValue"?: ((date: DateValue | undefined) => any) | undefined;
    }> & (typeof globalThis extends {
        __VLS_PROPS_FALLBACK: infer P;
    } ? P : {});
    expose: (exposed: {}) => void;
    attrs: any;
    slots: CalendarSlots;
    emit: ((evt: "update:modelValue", date: CalendarModelValue<R, M>) => void) & ((evt: "update:placeholder", ...args: [date: DateValue] & [date: DateValue]) => void) & ((evt: "update:validModelValue", date: DateRange) => void) & ((evt: "update:startValue", date: DateValue | undefined) => void);
}>) => import("vue").VNode & {
    __ctx?: Awaited<typeof __VLS_setup>;
};
type __VLS_PrettifyLocal<T> = (T extends any ? {
    [K in keyof T]: T[K];
} : {
    [K in keyof T as K]: T[K];
}) & {};
