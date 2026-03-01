import type { ProxyThumbnailService } from './proxyThumbnailService';

export async function ensureProxyCommand(params: {
  service: Pick<ProxyThumbnailService, 'ensureProxy'>;
  fileHandle: FileSystemFileHandle;
  projectRelativePath: string;
}): Promise<void> {
  await params.service.ensureProxy({
    fileHandle: params.fileHandle,
    projectRelativePath: params.projectRelativePath,
  });
}

export async function cancelProxyCommand(params: {
  service: Pick<ProxyThumbnailService, 'cancelProxy'>;
  projectRelativePath: string;
}): Promise<void> {
  await params.service.cancelProxy(params.projectRelativePath);
}

export async function removeProxyCommand(params: {
  service: Pick<ProxyThumbnailService, 'removeProxy'>;
  projectRelativePath: string;
}): Promise<void> {
  await params.service.removeProxy(params.projectRelativePath);
}

export async function clearVideoThumbnailsCommand(params: {
  service: Pick<ProxyThumbnailService, 'clearVideoThumbnails'>;
  projectId: string;
  projectRelativePath: string;
}): Promise<void> {
  await params.service.clearVideoThumbnails({
    projectId: params.projectId,
    projectRelativePath: params.projectRelativePath,
  });
}

export async function cleanupVideoCachesCommand(params: {
  service: Pick<ProxyThumbnailService, 'removeProxy' | 'clearVideoThumbnails'>;
  projectId: string;
  projectRelativePath: string;
}): Promise<void> {
  await params.service.removeProxy(params.projectRelativePath);
  await params.service.clearVideoThumbnails({
    projectId: params.projectId,
    projectRelativePath: params.projectRelativePath,
  });
}

export async function onVideoPathMovedCommand(params: {
  service: Pick<
    ProxyThumbnailService,
    'removeProxy' | 'clearExistingProxies' | 'clearVideoThumbnails' | 'checkExistingProxies'
  >;
  projectId: string;
  oldPath: string;
  newPath: string;
}): Promise<void> {
  await params.service.removeProxy(params.oldPath);
  params.service.clearExistingProxies();
  await params.service.clearVideoThumbnails({
    projectId: params.projectId,
    projectRelativePath: params.oldPath,
  });
  await params.service.checkExistingProxies([params.newPath]);
}
