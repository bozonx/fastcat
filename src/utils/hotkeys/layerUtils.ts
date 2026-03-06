import { pressedKeyCodes } from './pressedKeys';
import type { GranVideoEditorUserSettings } from '../settings/defaults';

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
  settings: GranVideoEditorUserSettings,
): boolean {
  return isLayerActive(e, settings.hotkeys.layer1 ?? 'Shift');
}

export function isLayer2Active(
  e: KeyboardEvent | MouseEvent | WheelEvent,
  settings: GranVideoEditorUserSettings,
): boolean {
  return isLayerActive(e, settings.hotkeys.layer2 ?? 'Control');
}
