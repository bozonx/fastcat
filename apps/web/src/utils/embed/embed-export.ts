import { ref, type ComputedRef, type InjectionKey } from 'vue';
import type { useExportForm } from '~/composables/timeline/export/useExportForm';

export type ExportFormInstance = ReturnType<typeof useExportForm>;

/**
 * How the export panel reaches the host from inside an embedded session.
 *
 * Outside an embed the panel renders into the project's `_export/` folder. In an
 * embed that folder is deleted with the session, so the panel hands its form to
 * the session instead, which delivers the file to the host exactly as the
 * toolbar's export button does.
 */
export interface EmbedExportDelegate {
  canExport: ComputedRef<boolean>;
  start: (form: ExportFormInstance) => Promise<void>;
}

export const EMBED_EXPORT_KEY: InjectionKey<EmbedExportDelegate> = Symbol('embed-export');

/**
 * The embed's own dialogs. An export is an action there rather than a view, so
 * its settings open over the editor; the state is module-level so a shortcut can
 * open them without reaching into the shell.
 */
export type EmbedDialog = 'export-settings' | 'format' | 'settings' | null;

export const embedDialog = ref<EmbedDialog>(null);

export function openEmbedExportSettings(): void {
  embedDialog.value = 'export-settings';
}
