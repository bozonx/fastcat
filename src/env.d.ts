declare module '*?inline' {
  const content: string;
  export default content;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module '#app' {
  interface NuxtApp {
    $mediaProcessor: import('~/media-processor/media-processor.types').IMediaProcessor;
  }
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}
