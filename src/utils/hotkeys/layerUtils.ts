import { pressedKeyCodes } from './pressedKeys';
import type { FastCatUserSettings } from '../settings/defaults';

export type LayerKey =
  | 'Shift'
  | 'Control'
  | 'Alt'
  | 'Meta'
  | 'ShiftLeft'
  | 'ShiftRight'
  | 'ControlLeft'
  | 'ControlRight'
  | 'AltLeft'
  | 'AltRight'
  | 'MetaLeft'
  | 'MetaRight';

export const LAYER_OPTIONS: { label: string; value: LayerKey }[] = [
  { label: 'Shift (Any)', value: 'Shift' },
  { label: 'Control (Any)', value: 'Control' },
  { label: 'Alt (Any)', value: 'Alt' },
  { label: 'Meta (Any)', value: 'Meta' },
  { label: 'Left Shift', value: 'ShiftLeft' },
  { label: 'Right Shift', value: 'ShiftRight' },
  { label: 'Left Control', value: 'ControlLeft' },
  { label: 'Right Control', value: 'ControlRight' },
  { label: 'Left Alt', value: 'AltLeft' },
  { label: 'Right Alt', value: 'AltRight' },
  { label: 'Left Meta', value: 'MetaLeft' },
  { label: 'Right Meta', value: 'MetaRight' },
];

export function isLayerActive(
  e: KeyboardEvent | MouseEvent | WheelEvent,
  layerType: LayerKey,
): boolean {
  if (layerType === 'Shift') return e.shiftKey;
  if (layerType === 'Control') return e.ctrlKey;
  if (layerType === 'Alt') return e.altKey;
  if (layerType === 'Meta') return e.metaKey;

  return pressedKeyCodes.has(layerType);
}

export function isLayer1Active(
  e: KeyboardEvent | MouseEvent | WheelEvent,
  settings: FastCatUserSettings,
): boolean {
  return isLayerActive(e, settings.hotkeys.layer1 ?? 'Shift');
}

export function isLayer2Active(
  e: KeyboardEvent | MouseEvent | WheelEvent,
  settings: FastCatUserSettings,
): boolean {
  return isLayerActive(e, settings.hotkeys.layer2 ?? 'Control');
}
