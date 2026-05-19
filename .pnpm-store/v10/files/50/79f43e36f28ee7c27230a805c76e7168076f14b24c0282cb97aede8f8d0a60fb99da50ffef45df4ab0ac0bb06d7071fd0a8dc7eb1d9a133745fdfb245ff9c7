<script>
import { getWeekNumber } from "reka-ui/date";
import theme from "#build/ui/calendar";
</script>

<script setup>
import { computed } from "vue";
import { useForwardPropsEmits } from "reka-ui";
import { Calendar as SingleCalendar, RangeCalendar } from "reka-ui/namespaced";
import { reactiveOmit } from "@vueuse/core";
import { useAppConfig } from "#imports";
import { useComponentUI } from "../composables/useComponentUI";
import { useLocale } from "../composables/useLocale";
import { tv } from "../utils/tv";
import UButton from "./Button.vue";
const props = defineProps({
  as: { type: null, required: false },
  nextYearIcon: { type: null, required: false },
  nextYear: { type: Object, required: false },
  nextMonthIcon: { type: null, required: false },
  nextMonth: { type: Object, required: false },
  prevYearIcon: { type: null, required: false },
  prevYear: { type: Object, required: false },
  prevMonthIcon: { type: null, required: false },
  prevMonth: { type: Object, required: false },
  color: { type: null, required: false },
  variant: { type: null, required: false },
  size: { type: null, required: false },
  range: { type: Boolean, required: false },
  multiple: { type: Boolean, required: false },
  monthControls: { type: Boolean, required: false, default: true },
  yearControls: { type: Boolean, required: false, default: true },
  defaultValue: { type: null, required: false },
  modelValue: { type: null, required: false },
  weekNumbers: { type: Boolean, required: false },
  class: { type: null, required: false },
  ui: { type: Object, required: false },
  defaultPlaceholder: { type: null, required: false },
  placeholder: { type: null, required: false },
  allowNonContiguousRanges: { type: Boolean, required: false },
  pagedNavigation: { type: Boolean, required: false },
  preventDeselect: { type: Boolean, required: false },
  maximumDays: { type: Number, required: false },
  weekStartsOn: { type: Number, required: false },
  weekdayFormat: { type: String, required: false },
  fixedWeeks: { type: Boolean, required: false, default: true },
  maxValue: { type: null, required: false },
  minValue: { type: null, required: false },
  numberOfMonths: { type: Number, required: false },
  disabled: { type: Boolean, required: false },
  readonly: { type: Boolean, required: false },
  initialFocus: { type: Boolean, required: false },
  isDateDisabled: { type: Function, required: false },
  isDateUnavailable: { type: Function, required: false },
  isDateHighlightable: { type: Function, required: false },
  nextPage: { type: Function, required: false },
  prevPage: { type: Function, required: false },
  disableDaysOutsideCurrentView: { type: Boolean, required: false },
  fixedDate: { type: String, required: false }
});
const emits = defineEmits(["update:modelValue", "update:placeholder", "update:validModelValue", "update:startValue"]);
defineSlots();
const { dir, t, locale } = useLocale();
const appConfig = useAppConfig();
const uiProp = useComponentUI("calendar", props);
const rootProps = useForwardPropsEmits(reactiveOmit(props, "range", "modelValue", "defaultValue", "color", "variant", "size", "monthControls", "yearControls", "class", "ui"), emits);
const nextYearIcon = computed(() => props.nextYearIcon || (dir.value === "rtl" ? appConfig.ui.icons.chevronDoubleLeft : appConfig.ui.icons.chevronDoubleRight));
const nextMonthIcon = computed(() => props.nextMonthIcon || (dir.value === "rtl" ? appConfig.ui.icons.chevronLeft : appConfig.ui.icons.chevronRight));
const prevYearIcon = computed(() => props.prevYearIcon || (dir.value === "rtl" ? appConfig.ui.icons.chevronDoubleRight : appConfig.ui.icons.chevronDoubleLeft));
const prevMonthIcon = computed(() => props.prevMonthIcon || (dir.value === "rtl" ? appConfig.ui.icons.chevronRight : appConfig.ui.icons.chevronLeft));
const ui = computed(() => tv({ extend: tv(theme), ...appConfig.ui?.calendar || {} })({
  color: props.color,
  size: props.size,
  variant: props.variant,
  weekNumbers: props.weekNumbers
}));
function paginateYear(date, sign) {
  if (sign === -1) {
    return date.subtract({ years: 1 });
  }
  return date.add({ years: 1 });
}
const Calendar = computed(() => props.range ? RangeCalendar : SingleCalendar);
</script>

<template>
  <Calendar.Root
    v-slot="{ weekDays, grid }"
    v-bind="rootProps"
    :model-value="modelValue"
    :default-value="defaultValue"
    data-slot="root"
    :class="ui.root({ class: [uiProp?.root, props.class] })"
  >
    <Calendar.Header data-slot="header" :class="ui.header({ class: uiProp?.header })">
      <Calendar.Prev v-if="props.yearControls" :prev-page="(date) => paginateYear(date, -1)" :aria-label="t('calendar.prevYear')" as-child>
        <UButton :icon="prevYearIcon" :size="props.size" color="neutral" variant="ghost" v-bind="props.prevYear" />
      </Calendar.Prev>
      <Calendar.Prev v-if="props.monthControls" :aria-label="t('calendar.prevMonth')" as-child>
        <UButton :icon="prevMonthIcon" :size="props.size" color="neutral" variant="ghost" v-bind="props.prevMonth" />
      </Calendar.Prev>
      <Calendar.Heading v-slot="{ headingValue }" data-slot="heading" :class="ui.heading({ class: uiProp?.heading })">
        <slot name="heading" :value="headingValue">
          {{ headingValue }}
        </slot>
      </Calendar.Heading>
      <Calendar.Next v-if="props.monthControls" :aria-label="t('calendar.nextMonth')" as-child>
        <UButton :icon="nextMonthIcon" :size="props.size" color="neutral" variant="ghost" v-bind="props.nextMonth" />
      </Calendar.Next>
      <Calendar.Next v-if="props.yearControls" :next-page="(date) => paginateYear(date, 1)" :aria-label="t('calendar.nextYear')" as-child>
        <UButton :icon="nextYearIcon" :size="props.size" color="neutral" variant="ghost" v-bind="props.nextYear" />
      </Calendar.Next>
    </Calendar.Header>
    <div data-slot="body" :class="ui.body({ class: uiProp?.body })">
      <Calendar.Grid
        v-for="month in grid"
        :key="month.value.toString()"
        data-slot="grid"
        :class="ui.grid({ class: uiProp?.grid })"
      >
        <Calendar.GridHead>
          <Calendar.GridRow data-slot="gridWeekDaysRow" :class="ui.gridWeekDaysRow({ class: uiProp?.gridWeekDaysRow })">
            <Calendar.HeadCell
              v-for="day in weekDays"
              :key="day"
              data-slot="headCell"
              :class="ui.headCell({ class: uiProp?.headCell })"
            >
              <slot name="week-day" :day="day">
                {{ day }}
              </slot>
            </Calendar.HeadCell>
          </Calendar.GridRow>
        </Calendar.GridHead>
        <Calendar.GridBody data-slot="gridBody" :class="ui.gridBody({ class: uiProp?.gridBody })">
          <Calendar.GridRow
            v-for="(weekDates, index) in month.rows"
            :key="`weekDate-${index}`"
            data-slot="gridRow"
            :class="ui.gridRow({ class: uiProp?.gridRow })"
          >
            <td
              v-if="weekNumbers && weekDates[0]"
              role="gridcell"
              data-slot="cellWeek"
              :class="ui.cellWeek({ class: uiProp?.cellWeek })"
            >
              {{ getWeekNumber(weekDates[0], locale.code) }}
            </td>
            <Calendar.Cell
              v-for="weekDate in weekDates"
              :key="weekDate.toString()"
              :date="weekDate"
              data-slot="cell"
              :class="ui.cell({ class: uiProp?.cell })"
            >
              <Calendar.CellTrigger
                :day="weekDate"
                :month="month.value"
                data-slot="cellTrigger"
                :class="ui.cellTrigger({ class: uiProp?.cellTrigger })"
              >
                <slot name="day" :day="weekDate">
                  {{ weekDate.day }}
                </slot>
              </Calendar.CellTrigger>
            </Calendar.Cell>
          </Calendar.GridRow>
        </Calendar.GridBody>
      </Calendar.Grid>
    </div>
  </Calendar.Root>
</template>
