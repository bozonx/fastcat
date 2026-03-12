import { describe, expect, it } from 'vitest';
import {
  getWorkspacePathFileName,
  getWorkspacePathParent,
  isProjectAudioPath,
  isProjectVideoPath,
  isWorkspaceCommonPath,
  normalizeWorkspaceFilePath,
  stripWorkspaceCommonPathPrefix,
  toWorkspaceCommonPath,
  toWorkspaceCommonStoragePath,
  WORKSPACE_COMMON_PATH_PREFIX,
} from '~/utils/workspace-common';

describe('workspace-common utils', () => {
  it('detects workspace common paths', () => {
    expect(WORKSPACE_COMMON_PATH_PREFIX).toBe('@common');
    expect(isWorkspaceCommonPath(WORKSPACE_COMMON_PATH_PREFIX)).toBe(true);
    expect(isWorkspaceCommonPath('@common/sub/timeline.otio')).toBe(true);
    expect(isWorkspaceCommonPath('common/sub/timeline.otio')).toBe(false);
    expect(isWorkspaceCommonPath('timelines/main.otio')).toBe(false);
  });

  it('normalizes workspace common and project paths', () => {
    expect(normalizeWorkspaceFilePath('  @common//folder / file.otio  ')).toBe(
      '@common/folder/file.otio',
    );
    expect(normalizeWorkspaceFilePath(' timelines//main.otio ')).toBe('timelines/main.otio');
  });

  it('converts relative paths to workspace common paths', () => {
    expect(toWorkspaceCommonPath('')).toBe(WORKSPACE_COMMON_PATH_PREFIX);
    expect(toWorkspaceCommonPath('nested/file.otio')).toBe('@common/nested/file.otio');
    expect(toWorkspaceCommonPath('@common/nested/file.otio')).toBe('@common/nested/file.otio');
  });

  it('maps workspace common path to physical storage path', () => {
    expect(toWorkspaceCommonStoragePath('@common')).toBe('common');
    expect(toWorkspaceCommonStoragePath('@common/nested/file.otio')).toBe(
      'common/nested/file.otio',
    );
  });

  it('strips workspace common prefix', () => {
    expect(stripWorkspaceCommonPathPrefix('@common')).toBe('');
    expect(stripWorkspaceCommonPathPrefix('@common/nested/file.otio')).toBe('nested/file.otio');
  });

  it('resolves parent path for project and workspace common paths', () => {
    expect(getWorkspacePathParent('timelines/file.otio')).toBe('timelines');
    expect(getWorkspacePathParent('@common/nested/file.otio')).toBe('@common/nested');
    expect(getWorkspacePathParent('@common/nested')).toBe('@common');
    expect(getWorkspacePathParent('@common')).toBe('');
  });

  it('resolves file names for project and workspace common paths', () => {
    expect(getWorkspacePathFileName('timelines/file.otio')).toBe('file.otio');
    expect(getWorkspacePathFileName('@common/nested/file.otio')).toBe('file.otio');
    expect(getWorkspacePathFileName('@common')).toBe('@common');
  });

  it('identifies project media paths', () => {
    expect(isProjectVideoPath('_video/clip.mp4')).toBe(true);
    expect(isProjectVideoPath('@common/_video/clip.mp4')).toBe(true);
    expect(isProjectVideoPath('_audio/clip.mp4')).toBe(false);

    expect(isProjectAudioPath('_audio/clip.mp3')).toBe(true);
    expect(isProjectAudioPath('@common/_audio/clip.mp3')).toBe(true);
    expect(isProjectAudioPath('_video/clip.mp3')).toBe(false);
  });
});
