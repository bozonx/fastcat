/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import { usePendingNewProjectFiles } from '~/composables/project/useProjectManagement';

describe('usePendingNewProjectFiles', () => {
  const { pendingFilesForNewProject } = usePendingNewProjectFiles();

  beforeEach(() => {
    pendingFilesForNewProject.value = [];
  });

  it('initially has no pending files', () => {
    expect(pendingFilesForNewProject.value).toEqual([]);
  });

  it('allows setting pending files', () => {
    const file1 = new File(['foo'], 'foo.mp4', { type: 'video/mp4' });
    const file2 = new File(['bar'], 'bar.png', { type: 'image/png' });
    pendingFilesForNewProject.value = [file1, file2];

    expect(pendingFilesForNewProject.value).toHaveLength(2);
    expect(pendingFilesForNewProject.value[0]?.name).toBe('foo.mp4');
    expect(pendingFilesForNewProject.value[1]?.name).toBe('bar.png');
  });

  it('allows clearing pending files', () => {
    const file1 = new File(['foo'], 'foo.mp4', { type: 'video/mp4' });
    pendingFilesForNewProject.value = [file1];
    expect(pendingFilesForNewProject.value).toHaveLength(1);

    pendingFilesForNewProject.value = [];
    expect(pendingFilesForNewProject.value).toEqual([]);
  });
});
