import { ref } from 'vue';
import { defineStore } from 'pinia';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { PROXY_DIR_NAME } from '~/utils/constants';

export const useProxyStore = defineStore('proxy', () => {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();

  const generatingProxies = ref<Set<string>>(new Set());
  const existingProxies = ref<Set<string>>(new Set());
  const proxyProgress = ref<Record<string, number>>({});

  function getProxyFileName(projectRelativePath: string): string {
    return `${encodeURIComponent(projectRelativePath)}.webm`;
  }

  async function ensureProjectProxiesDir(): Promise<FileSystemDirectoryHandle | null> {
    if (!workspaceStore.workspaceHandle || !projectStore.currentProjectName) return null;
    try {
      const proxiesDir = await workspaceStore.workspaceHandle.getDirectoryHandle(PROXY_DIR_NAME, {
        create: true,
      });
      return await proxiesDir.getDirectoryHandle(projectStore.currentProjectName, { create: true });
    } catch {
      return null;
    }
  }

  async function checkExistingProxies(paths: string[]) {
    const dir = await ensureProjectProxiesDir();
    if (!dir) return;

    for (const path of paths) {
      if (!path.startsWith('sources/video/')) continue;
      try {
        await dir.getFileHandle(getProxyFileName(path));
        existingProxies.value.add(path);
      } catch {
        existingProxies.value.delete(path);
      }
    }
  }

  async function generateProxy(
    fileHandle: FileSystemFileHandle,
    projectRelativePath: string,
  ): Promise<void> {
    if (generatingProxies.value.has(projectRelativePath)) return;
    if (!projectRelativePath.startsWith('sources/video/')) return;

    const dir = await ensureProjectProxiesDir();
    if (!dir) throw new Error('Could not access proxies directory');

    generatingProxies.value.add(projectRelativePath);
    proxyProgress.value[projectRelativePath] = 0;

    try {
      const proxyFilename = getProxyFileName(projectRelativePath);
      const targetHandle = await dir.getFileHandle(proxyFilename, { create: true });

      const { optimization } = workspaceStore.userSettings;

      let width = 1280;
      let height = 720;
      if (optimization.proxyResolution === '360p') {
        width = 640;
        height = 360;
      } else if (optimization.proxyResolution === '480p') {
        width = 854;
        height = 480;
      } else if (optimization.proxyResolution === '1080p') {
        width = 1920;
        height = 1080;
      }

      const { client } = getExportWorkerClient();

      setExportHostApi({
        getFileHandleByPath: async (path) => projectStore.getFileHandleByPath(path),
        onExportProgress: (progress) => {
          proxyProgress.value[projectRelativePath] = progress;
        },
      });

      const meta = await client.extractMetadata(fileHandle);
      const durationUs = Math.round((meta.duration || 0) * 1_000_000);

      if (!durationUs) throw new Error('Invalid video duration');

      const videoClips = [
        {
          kind: 'clip',
          id: 'proxy_video',
          layer: 0,
          source: { path: projectRelativePath },
          timelineRange: { startUs: 0, durationUs },
          sourceRange: { startUs: 0, durationUs },
        },
      ];

      const audioClips = meta.audio
        ? [
            {
              kind: 'clip',
              id: 'proxy_audio',
              layer: 0,
              source: { path: projectRelativePath },
              timelineRange: { startUs: 0, durationUs },
              sourceRange: { startUs: 0, durationUs },
            },
          ]
        : [];

      const isOpusAudio =
        typeof meta.audio?.codec === 'string' && meta.audio.codec.toLowerCase().startsWith('opus');

      const options = {
        format: 'webm',
        videoCodec: 'vp09.00.10.08',
        bitrate: optimization.proxyVideoBitrateMbps * 1_000_000,
        audioBitrate: optimization.proxyAudioBitrateKbps * 1000,
        audio: !!meta.audio,
        audioCodec: 'opus',
        audioPassthrough: optimization.proxyCopyOpusAudio && isOpusAudio,
        width,
        height,
        fps: meta.video?.fps || 30,
      };

      await (client as any).exportTimeline(targetHandle, options, videoClips, audioClips);

      existingProxies.value.add(projectRelativePath);
    } finally {
      generatingProxies.value.delete(projectRelativePath);
      delete proxyProgress.value[projectRelativePath];
    }
  }

  async function deleteProxy(projectRelativePath: string) {
    if (!projectRelativePath.startsWith('sources/video/')) return;
    const dir = await ensureProjectProxiesDir();
    if (!dir) return;

    try {
      await dir.removeEntry(getProxyFileName(projectRelativePath));
      existingProxies.value.delete(projectRelativePath);
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to delete proxy', e);
      }
    }
  }

  async function getProxyFileHandle(
    projectRelativePath: string,
  ): Promise<FileSystemFileHandle | null> {
    if (!projectRelativePath.startsWith('sources/video/')) return null;
    const dir = await ensureProjectProxiesDir();
    if (!dir) return null;

    try {
      return await dir.getFileHandle(getProxyFileName(projectRelativePath));
    } catch {
      return null;
    }
  }

  async function getProxyFile(projectRelativePath: string): Promise<File | null> {
    if (!projectRelativePath.startsWith('sources/video/')) return null;
    const dir = await ensureProjectProxiesDir();
    if (!dir) return null;

    try {
      const handle = await dir.getFileHandle(getProxyFileName(projectRelativePath));
      return await handle.getFile();
    } catch {
      return null;
    }
  }

  return {
    generatingProxies,
    existingProxies,
    proxyProgress,
    checkExistingProxies,
    generateProxy,
    deleteProxy,
    getProxyFileHandle,
    getProxyFile,
  };
});
