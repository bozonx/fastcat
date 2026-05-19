//#region ../../node_modules/.pnpm/esbuild@0.27.3/node_modules/esbuild/lib/main.d.ts
type Platform = 'browser' | 'node' | 'neutral';
type Format = 'iife' | 'cjs' | 'esm';
type Loader = 'base64' | 'binary' | 'copy' | 'css' | 'dataurl' | 'default' | 'empty' | 'file' | 'js' | 'json' | 'jsx' | 'local-css' | 'text' | 'ts' | 'tsx';
type LogLevel = 'verbose' | 'debug' | 'info' | 'warning' | 'error' | 'silent';
type Charset = 'ascii' | 'utf8';
type Drop = 'console' | 'debugger';
type AbsPaths = 'code' | 'log' | 'metafile';
interface CommonOptions {
  /** Documentation: https://esbuild.github.io/api/#sourcemap */
  sourcemap?: boolean | 'linked' | 'inline' | 'external' | 'both';
  /** Documentation: https://esbuild.github.io/api/#legal-comments */
  legalComments?: 'none' | 'inline' | 'eof' | 'linked' | 'external';
  /** Documentation: https://esbuild.github.io/api/#source-root */
  sourceRoot?: string;
  /** Documentation: https://esbuild.github.io/api/#sources-content */
  sourcesContent?: boolean;
  /** Documentation: https://esbuild.github.io/api/#format */
  format?: Format;
  /** Documentation: https://esbuild.github.io/api/#global-name */
  globalName?: string;
  /** Documentation: https://esbuild.github.io/api/#target */
  target?: string | string[];
  /** Documentation: https://esbuild.github.io/api/#supported */
  supported?: Record<string, boolean>;
  /** Documentation: https://esbuild.github.io/api/#platform */
  platform?: Platform;
  /** Documentation: https://esbuild.github.io/api/#mangle-props */
  mangleProps?: RegExp;
  /** Documentation: https://esbuild.github.io/api/#mangle-props */
  reserveProps?: RegExp;
  /** Documentation: https://esbuild.github.io/api/#mangle-props */
  mangleQuoted?: boolean;
  /** Documentation: https://esbuild.github.io/api/#mangle-props */
  mangleCache?: Record<string, string | false>;
  /** Documentation: https://esbuild.github.io/api/#drop */
  drop?: Drop[];
  /** Documentation: https://esbuild.github.io/api/#drop-labels */
  dropLabels?: string[];
  /** Documentation: https://esbuild.github.io/api/#minify */
  minify?: boolean;
  /** Documentation: https://esbuild.github.io/api/#minify */
  minifyWhitespace?: boolean;
  /** Documentation: https://esbuild.github.io/api/#minify */
  minifyIdentifiers?: boolean;
  /** Documentation: https://esbuild.github.io/api/#minify */
  minifySyntax?: boolean;
  /** Documentation: https://esbuild.github.io/api/#line-limit */
  lineLimit?: number;
  /** Documentation: https://esbuild.github.io/api/#charset */
  charset?: Charset;
  /** Documentation: https://esbuild.github.io/api/#tree-shaking */
  treeShaking?: boolean;
  /** Documentation: https://esbuild.github.io/api/#ignore-annotations */
  ignoreAnnotations?: boolean;
  /** Documentation: https://esbuild.github.io/api/#jsx */
  jsx?: 'transform' | 'preserve' | 'automatic';
  /** Documentation: https://esbuild.github.io/api/#jsx-factory */
  jsxFactory?: string;
  /** Documentation: https://esbuild.github.io/api/#jsx-fragment */
  jsxFragment?: string;
  /** Documentation: https://esbuild.github.io/api/#jsx-import-source */
  jsxImportSource?: string;
  /** Documentation: https://esbuild.github.io/api/#jsx-development */
  jsxDev?: boolean;
  /** Documentation: https://esbuild.github.io/api/#jsx-side-effects */
  jsxSideEffects?: boolean;
  /** Documentation: https://esbuild.github.io/api/#define */
  define?: {
    [key: string]: string;
  };
  /** Documentation: https://esbuild.github.io/api/#pure */
  pure?: string[];
  /** Documentation: https://esbuild.github.io/api/#keep-names */
  keepNames?: boolean;
  /** Documentation: https://esbuild.github.io/api/#abs-paths */
  absPaths?: AbsPaths[];
  /** Documentation: https://esbuild.github.io/api/#color */
  color?: boolean;
  /** Documentation: https://esbuild.github.io/api/#log-level */
  logLevel?: LogLevel;
  /** Documentation: https://esbuild.github.io/api/#log-limit */
  logLimit?: number;
  /** Documentation: https://esbuild.github.io/api/#log-override */
  logOverride?: Record<string, LogLevel>;
  /** Documentation: https://esbuild.github.io/api/#tsconfig-raw */
  tsconfigRaw?: string | TsconfigRaw;
}
interface TsconfigRaw {
  compilerOptions?: {
    alwaysStrict?: boolean;
    baseUrl?: string;
    experimentalDecorators?: boolean;
    importsNotUsedAsValues?: 'remove' | 'preserve' | 'error';
    jsx?: 'preserve' | 'react-native' | 'react' | 'react-jsx' | 'react-jsxdev';
    jsxFactory?: string;
    jsxFragmentFactory?: string;
    jsxImportSource?: string;
    paths?: Record<string, string[]>;
    preserveValueImports?: boolean;
    strict?: boolean;
    target?: string;
    useDefineForClassFields?: boolean;
    verbatimModuleSyntax?: boolean;
  };
}
interface TransformOptions extends CommonOptions {
  /** Documentation: https://esbuild.github.io/api/#sourcefile */
  sourcefile?: string;
  /** Documentation: https://esbuild.github.io/api/#loader */
  loader?: Loader;
  /** Documentation: https://esbuild.github.io/api/#banner */
  banner?: string;
  /** Documentation: https://esbuild.github.io/api/#footer */
  footer?: string;
}
// Note: These declarations exist to avoid type errors when you omit "dom" from
// "lib" in your "tsconfig.json" file. TypeScript confusingly declares the
// global "WebAssembly" type in "lib.dom.d.ts" even though it has nothing to do
// with the browser DOM and is present in many non-browser JavaScript runtimes
// (e.g. node and deno). Declaring it here allows esbuild's API to be used in
// these scenarios.
//
// There's an open issue about getting this problem corrected (although these
// declarations will need to remain even if this is fixed for backward
// compatibility with older TypeScript versions):
//
//   https://github.com/microsoft/TypeScript-DOM-lib-generator/issues/826
//
declare global {
  namespace WebAssembly {
    interface Module {}
  }
  interface URL {}
}
//#endregion
export { TransformOptions as n, Loader as t };