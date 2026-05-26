import { writeFileAtomic } from '~/utils/io/atomic-file-write';
import { withFileIoSlot } from '~/utils/io/io-governor';

const AUDIO_CHUNK_CACHE_VERSION = 1;
const AUDIO_CHUNK_CACHE_MAGIC = 0x46434131; // FCA1
const HEADER_PREFIX_BYTES = 8;

function alignToFloat32(value: number): number {
  return Math.ceil(value / Float32Array.BYTES_PER_ELEMENT) * Float32Array.BYTES_PER_ELEMENT;
}

export interface AudioChunkFileCacheMetadata {
  sourceKey: string;
  chunkIndex: number;
  chunkSizeS: number;
  sourceSize: number;
  sourceLastModified: number;
  startTimeS: number;
  durationS: number;
  sampleRate: number;
  numberOfChannels: number;
  totalFrames: number;
}

export interface PersistedAudioChunk {
  chunkIndex: number;
  startTimeS: number;
  durationS: number;
  buffer: AudioBuffer;
}

interface CacheHeader extends AudioChunkFileCacheMetadata {
  version: number;
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function getSourceDirectoryName(sourceKey: string): string {
  return hashString(sourceKey);
}

function getChunkFileName(chunkIndex: number): string {
  return `${chunkIndex}.facpcm`;
}

function getSourceStamp(
  file: File,
): Pick<AudioChunkFileCacheMetadata, 'sourceSize' | 'sourceLastModified'> {
  return {
    sourceSize: file.size,
    sourceLastModified: file.lastModified,
  };
}

async function getSourceCacheDir(params: {
  cacheRoot: FileSystemDirectoryHandle;
  sourceKey: string;
  create?: boolean;
}): Promise<FileSystemDirectoryHandle> {
  return await params.cacheRoot.getDirectoryHandle(getSourceDirectoryName(params.sourceKey), {
    create: params.create,
  });
}

function isMetadataMatch(params: {
  header: CacheHeader;
  expected: AudioChunkFileCacheMetadata;
}): boolean {
  const { header, expected } = params;
  return (
    header.version === AUDIO_CHUNK_CACHE_VERSION &&
    header.sourceKey === expected.sourceKey &&
    header.chunkIndex === expected.chunkIndex &&
    header.chunkSizeS === expected.chunkSizeS &&
    header.sourceSize === expected.sourceSize &&
    header.sourceLastModified === expected.sourceLastModified &&
    header.sampleRate > 0 &&
    header.numberOfChannels > 0 &&
    header.totalFrames > 0
  );
}

function serializeAudioBuffer(params: {
  metadata: AudioChunkFileCacheMetadata;
  buffer: AudioBuffer;
}): ArrayBuffer {
  const header: CacheHeader = {
    version: AUDIO_CHUNK_CACHE_VERSION,
    ...params.metadata,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const payloadOffset = alignToFloat32(HEADER_PREFIX_BYTES + headerBytes.byteLength);
  const payloadBytes =
    params.buffer.numberOfChannels * params.buffer.length * Float32Array.BYTES_PER_ELEMENT;
  const output = new ArrayBuffer(payloadOffset + payloadBytes);
  const view = new DataView(output);
  view.setUint32(0, AUDIO_CHUNK_CACHE_MAGIC, true);
  view.setUint32(4, headerBytes.byteLength, true);
  new Uint8Array(output, HEADER_PREFIX_BYTES, headerBytes.byteLength).set(headerBytes);

  let offset = payloadOffset;
  for (let ch = 0; ch < params.buffer.numberOfChannels; ch += 1) {
    const channel = params.buffer.getChannelData(ch);
    new Float32Array(output, offset, channel.length).set(channel);
    offset += channel.byteLength;
  }

  return output;
}

function deserializeAudioBuffer(params: {
  data: ArrayBuffer;
  expected: AudioChunkFileCacheMetadata;
  context: BaseAudioContext;
}): PersistedAudioChunk | null {
  if (params.data.byteLength < HEADER_PREFIX_BYTES) return null;

  const view = new DataView(params.data);
  if (view.getUint32(0, true) !== AUDIO_CHUNK_CACHE_MAGIC) return null;

  const headerLength = view.getUint32(4, true);
  const headerEnd = HEADER_PREFIX_BYTES + headerLength;
  if (headerLength <= 0 || headerEnd > params.data.byteLength) return null;

  const headerText = new TextDecoder().decode(
    new Uint8Array(params.data, HEADER_PREFIX_BYTES, headerLength),
  );
  const header = JSON.parse(headerText) as CacheHeader;
  if (!isMetadataMatch({ header, expected: params.expected })) return null;

  const payloadOffset = alignToFloat32(headerEnd);
  const channelBytes = header.totalFrames * Float32Array.BYTES_PER_ELEMENT;
  const expectedBytes = payloadOffset + channelBytes * header.numberOfChannels;
  if (expectedBytes > params.data.byteLength) return null;

  const buffer = params.context.createBuffer(
    header.numberOfChannels,
    header.totalFrames,
    header.sampleRate,
  );

  let offset = payloadOffset;
  for (let ch = 0; ch < header.numberOfChannels; ch += 1) {
    const channel = new Float32Array(params.data, offset, header.totalFrames);
    buffer.copyToChannel(channel, ch, 0);
    offset += channelBytes;
  }

  return {
    chunkIndex: header.chunkIndex,
    startTimeS: header.startTimeS,
    durationS: header.durationS,
    buffer,
  };
}

export async function readAudioChunkFromFileCache(params: {
  cacheRoot: FileSystemDirectoryHandle | null;
  sourceKey: string;
  chunkIndex: number;
  chunkSizeS: number;
  sourceFile: File;
  context: BaseAudioContext;
}): Promise<PersistedAudioChunk | null> {
  if (!params.cacheRoot) return null;

  const expected: AudioChunkFileCacheMetadata = {
    sourceKey: params.sourceKey,
    chunkIndex: params.chunkIndex,
    chunkSizeS: params.chunkSizeS,
    ...getSourceStamp(params.sourceFile),
    startTimeS: 0,
    durationS: 0,
    sampleRate: 0,
    numberOfChannels: 0,
    totalFrames: 0,
  };

  try {
    const sourceDir = await getSourceCacheDir({
      cacheRoot: params.cacheRoot,
      sourceKey: params.sourceKey,
    });
    const handle = await sourceDir.getFileHandle(getChunkFileName(params.chunkIndex));
    const file = await withFileIoSlot(() => handle.getFile());
    const data = await withFileIoSlot(() => file.arrayBuffer());
    return deserializeAudioBuffer({
      data,
      expected,
      context: params.context,
    });
  } catch {
    return null;
  }
}

export async function writeAudioChunkToFileCache(params: {
  cacheRoot: FileSystemDirectoryHandle | null;
  sourceKey: string;
  chunkIndex: number;
  chunkSizeS: number;
  sourceFile: File;
  chunk: PersistedAudioChunk;
}): Promise<void> {
  if (!params.cacheRoot) return;

  const metadata: AudioChunkFileCacheMetadata = {
    sourceKey: params.sourceKey,
    chunkIndex: params.chunkIndex,
    chunkSizeS: params.chunkSizeS,
    ...getSourceStamp(params.sourceFile),
    startTimeS: params.chunk.startTimeS,
    durationS: params.chunk.durationS,
    sampleRate: params.chunk.buffer.sampleRate,
    numberOfChannels: params.chunk.buffer.numberOfChannels,
    totalFrames: params.chunk.buffer.length,
  };

  const sourceDir = await getSourceCacheDir({
    cacheRoot: params.cacheRoot,
    sourceKey: params.sourceKey,
    create: true,
  });
  const data = serializeAudioBuffer({ metadata, buffer: params.chunk.buffer });
  await writeFileAtomic({
    dir: sourceDir,
    fileName: getChunkFileName(params.chunkIndex),
    data,
  });
}
