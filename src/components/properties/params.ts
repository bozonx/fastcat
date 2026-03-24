export interface ParamOption {
  label?: string;
  labelKey?: string;
  value: string | number | boolean;
}

interface BaseParamControl {
  key?: string;
  label?: string;
  labelKey?: string;
  showIf?: (values: Record<string, any>) => boolean;
  disabled?: boolean;
}

export interface SliderParamControl extends BaseParamControl {
  kind: 'slider';
  key: string;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  defaultValue?: number;
}

export interface NumberParamControl extends BaseParamControl {
  kind: 'number';
  key: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
}

export interface ToggleParamControl extends BaseParamControl {
  kind: 'toggle' | 'boolean';
  key: string;
}

export interface SelectParamControl extends BaseParamControl {
  kind: 'select';
  key: string;
  options: ParamOption[];
}

export interface ButtonGroupParamControl extends BaseParamControl {
  kind: 'button-group';
  key: string;
  options: ParamOption[];
}

export interface ColorParamControl extends BaseParamControl {
  kind: 'color';
  key: string;
}

export interface FileParamControl extends BaseParamControl {
  kind: 'file';
  key: string;
  kindKey?: string;
  emptyLabel?: string;
  emptyLabelKey?: string;
  icon?: string;
}

export interface RowParamControl extends BaseParamControl {
  kind: 'row';
  columns?: 1 | 2;
  controls: ParamControl[];
}

export interface TextParamControl extends BaseParamControl {
  kind: 'text';
  key: string;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}

export interface ActionParamControl extends BaseParamControl {
  kind: 'action';
  key: string;
  action: 'open-settings' | string;
  buttonLabel?: string;
  buttonLabelKey?: string;
  icon?: string;
}

export interface ArrayParamControl extends BaseParamControl {
  kind: 'array';
  key: string;
  itemTemplate: ParamControl[];
  defaultItem: Record<string, any>;
  addLabel?: string;
  addLabelKey?: string;
  emptyLabel?: string;
  emptyLabelKey?: string;
  layout?: 'vertical' | 'horizontal'; // Add layout option
}

export interface KnobParamControl extends BaseParamControl {
  kind: 'knob';
  key: string;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  defaultValue?: number;
}

export interface ScaleXYParamControl extends BaseParamControl {
  kind: 'scale-xy';
  keyX: string;
  keyY: string;
  keyLinked: string;
  labelKey?: string;
  labelXKey?: string;
  labelYKey?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValueX?: number;
  defaultValueY?: number;
  defaultLinked?: boolean;
}

export type ParamControl =
  | SliderParamControl
  | NumberParamControl
  | KnobParamControl
  | ScaleXYParamControl
  | ToggleParamControl
  | SelectParamControl
  | ButtonGroupParamControl
  | ColorParamControl
  | FileParamControl
  | RowParamControl
  | TextParamControl
  | ActionParamControl
  | ArrayParamControl;
