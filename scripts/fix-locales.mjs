import { readFile, writeFile } from 'node:fs/promises';

const configs = [
  { json: 'src/locales/en-US.json', ts: 'src/locales/en-US.ts', isRu: false },
  { json: 'src/locales/ru-RU.json', ts: 'src/locales/ru-RU.ts', isRu: true },
];

for (const { json, ts, isRu } of configs) {
  const data = JSON.parse(await readFile(json, 'utf8'));

  // Remove unused keys
  delete data.fastcat.track.mute;
  delete data.fastcat.track.solo;
  delete data.fastcat.track.unmute;

  delete data.videoEditor.settings.contentRootPath;
  delete data.videoEditor.settings.contentRootPathHelp;
  delete data.videoEditor.settings.dataRootPath;
  delete data.videoEditor.settings.dataRootPathHelp;
  delete data.videoEditor.settings.ephemeralTmpRootPath;
  delete data.videoEditor.settings.ephemeralTmpRootPathHelp;
  delete data.videoEditor.settings.portableEphemeralTmpRootPathHelp;
  delete data.videoEditor.settings.proxiesRootPath;
  delete data.videoEditor.settings.proxiesRootPathHelp;
  delete data.videoEditor.settings.selectWorkspaceFolder;
  delete data.videoEditor.settings.storageMode;
  delete data.videoEditor.settings.storageModeHelp;
  delete data.videoEditor.settings.tempRootPath;
  delete data.videoEditor.settings.tempRootPathHelp;
  delete data.videoEditor.settings.workspaceFolder;
  delete data.videoEditor.settings.workspaceFolderDescription;

  // Add missing keys
  if (!data.fastcat.preview.codecError) {
    data.fastcat.preview.codecError = isRu
      ? 'Кодек не поддерживается на этой платформе. Конвертируйте в H264/AAC для предпросмотра.'
      : 'Codec not supported on this platform. Convert to H264/AAC for preview.';
  }
  if (!data.fastcat.preview.formatError) {
    data.fastcat.preview.formatError = isRu
      ? 'Формат файла не поддерживается браузером. Конвертируйте в MP4/WebM для предпросмотра.'
      : 'File format not supported by the browser. Convert to MP4/WebM for preview.';
  }
  if (!data.fastcat.preview.playbackError) {
    data.fastcat.preview.playbackError = isRu ? 'Ошибка воспроизведения' : 'Playback error';
  }
  if (!data.fastcat.timeline.itemOverlap) {
    data.fastcat.timeline.itemOverlap = isRu
      ? 'Элемент перекрывается с другим элементом'
      : 'Item overlaps with another item';
  }
  if (!data.videoEditor.timeline.backups.cannotDeleteMain) {
    data.videoEditor.timeline.backups.cannotDeleteMain = isRu
      ? 'Нельзя удалить основную версию файла'
      : 'Cannot delete main file version';
  }
  if (!data.videoEditor.timeline.backups.loadError) {
    data.videoEditor.timeline.backups.loadError = isRu
      ? 'Не удалось загрузить резервные копии'
      : 'Failed to load backup versions';
  }

  const jsonStr = JSON.stringify(data, null, 2) + '\n';
  await writeFile(json, jsonStr);
  await writeFile(ts, `export default ${jsonStr}`);

  console.log('Updated', json, 'and', ts);
}
