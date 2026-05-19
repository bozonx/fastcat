import * as fs from "fs";

//#region ../../node_modules/.pnpm/@vercel+nft@1.2.0_rollup@4.57.1/node_modules/@vercel/nft/out/node-file-trace.d.ts
declare class Job {
  ts: boolean;
  base: string;
  cwd: string;
  conditions: string[];
  exportsOnly: boolean;
  paths: Record<string, string>;
  ignoreFn: (path: string, parent?: string) => boolean;
  log: boolean;
  mixedModules: boolean;
  analysis: {
    emitGlobs?: boolean;
    computeFileReferences?: boolean;
    evaluatePureExpressions?: boolean;
  };
  private analysisCache;
  fileList: Set<string>;
  esmFileList: Set<string>;
  processed: Set<string>;
  warnings: Set<Error>;
  reasons: NodeFileTraceReasons;
  private cachedFileSystem;
  private remappings;
  constructor({
    base,
    processCwd,
    exports,
    conditions,
    exportsOnly,
    paths,
    ignore,
    log,
    mixedModules,
    ts,
    analysis,
    cache,
    fileIOConcurrency
  }: NodeFileTraceOptions);
  addRemapping(path: string, dep: string): void;
  readlink(path: string): Promise<string | null>;
  isFile(path: string): Promise<boolean>;
  isDir(path: string): Promise<boolean>;
  stat(path: string): Promise<fs.Stats | null>;
  private maybeEmitDep;
  resolve(id: string, parent: string, job: Job, cjsResolve: boolean): Promise<string | string[]>;
  readFile(path: string): Promise<Buffer | string | null>;
  realpath(path: string, parent?: string, seen?: Set<unknown>): Promise<string>;
  emitFile(path: string, reasonType: NodeFileTraceReasonType, parent?: string, isRealpath?: boolean): Promise<boolean>;
  getPjsonBoundary(path: string): Promise<string | undefined>;
  emitDependency(path: string, parent?: string): Promise<void>;
}
//#endregion
//#region ../../node_modules/.pnpm/@vercel+nft@1.2.0_rollup@4.57.1/node_modules/@vercel/nft/out/types.d.ts
interface Stats {
  isFile(): boolean;
  isDirectory(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
  isSymbolicLink(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  size: number;
  blksize: number;
  blocks: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;
}
interface NodeFileTraceOptions {
  base?: string;
  processCwd?: string;
  exports?: string[];
  conditions?: string[];
  exportsOnly?: boolean;
  ignore?: string | string[] | ((path: string) => boolean);
  analysis?: boolean | {
    emitGlobs?: boolean;
    computeFileReferences?: boolean;
    evaluatePureExpressions?: boolean;
  };
  cache?: any;
  paths?: Record<string, string>;
  ts?: boolean;
  log?: boolean;
  mixedModules?: boolean;
  readFile?: (path: string) => Promise<Buffer | string | null>;
  stat?: (path: string) => Promise<Stats | null>;
  readlink?: (path: string) => Promise<string | null>;
  resolve?: (id: string, parent: string, job: Job, cjsResolve: boolean) => Promise<string | string[]>;
  fileIOConcurrency?: number;
}
type NodeFileTraceReasonType = 'initial' | 'resolve' | 'dependency' | 'asset' | 'sharedlib';
interface NodeFileTraceReasons extends Map<string, {
  type: NodeFileTraceReasonType[];
  ignored: boolean;
  parents: Set<string>;
}> {}
//#endregion
export { NodeFileTraceOptions as t };