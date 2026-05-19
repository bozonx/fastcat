/// <reference types="node" />
import { t as ConnectorName } from "./db0.mjs";
import { n as OutputOptions$1, r as Plugin$2, t as InputOptions$1 } from "./@rollup/plugin-commonjs.mjs";
import { t as Program } from "./@oxc-project/types.mjs";
import { t as TopLevelFilterExpression } from "./@rolldown/pluginutils.mjs";
import { ConsolaInstance, LogLevel } from "consola";
import { Stats } from "node:fs";
import { URL as URL$1, URLSearchParams } from "node:url";
import "jiti";
import "webpack";
import "@rspack/core";
import "vite";
import { EventHandler, H3Core, HTTPError, HTTPEvent, HTTPHandler, HTTPMethod, Middleware, ProxyOptions } from "h3";
import * as stream from "node:stream";
import { Duplex, Readable, Writable } from "node:stream";
import { EventEmitter } from "node:events";
import { Blob as Blob$1, File } from "node:buffer";
import "node:stream/web";
import { ConnectionOptions, TLSSocket } from "node:tls";
import { IpcNetConnectOpts, Socket, TcpNetConnectOpts } from "node:net";
import "node:dns";
import "node:worker_threads";
import { Hookable, HookableCore, NestedHooks } from "hookable";
import { ExecutionContext, ForwardableEmailMessage, MessageBatch, ScheduledController, TraceItem } from "@cloudflare/workers-types";
import { DurableObject } from "cloudflare:workers";
import "node:http";
import "node:https";
import "ohash/utils";
import "node:http2";
import "nitro";

//#region ../../node_modules/.pnpm/undici@7.19.1/node_modules/undici/types/utility.d.ts
type AutocompletePrimitiveBaseType<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : never;
type Autocomplete<T> = T | (AutocompletePrimitiveBaseType<T> & Record<never, never>);
//#endregion
//#region ../../node_modules/.pnpm/undici@7.19.1/node_modules/undici/types/header.d.ts
/**
 * The header type declaration of `undici`.
 */
type IncomingHttpHeaders = Record<string, string | string[] | undefined>;
type HeaderNames = Autocomplete<'Accept' | 'Accept-CH' | 'Accept-Charset' | 'Accept-Encoding' | 'Accept-Language' | 'Accept-Patch' | 'Accept-Post' | 'Accept-Ranges' | 'Access-Control-Allow-Credentials' | 'Access-Control-Allow-Headers' | 'Access-Control-Allow-Methods' | 'Access-Control-Allow-Origin' | 'Access-Control-Expose-Headers' | 'Access-Control-Max-Age' | 'Access-Control-Request-Headers' | 'Access-Control-Request-Method' | 'Age' | 'Allow' | 'Alt-Svc' | 'Alt-Used' | 'Authorization' | 'Cache-Control' | 'Clear-Site-Data' | 'Connection' | 'Content-Disposition' | 'Content-Encoding' | 'Content-Language' | 'Content-Length' | 'Content-Location' | 'Content-Range' | 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only' | 'Content-Type' | 'Cookie' | 'Cross-Origin-Embedder-Policy' | 'Cross-Origin-Opener-Policy' | 'Cross-Origin-Resource-Policy' | 'Date' | 'Device-Memory' | 'ETag' | 'Expect' | 'Expect-CT' | 'Expires' | 'Forwarded' | 'From' | 'Host' | 'If-Match' | 'If-Modified-Since' | 'If-None-Match' | 'If-Range' | 'If-Unmodified-Since' | 'Keep-Alive' | 'Last-Modified' | 'Link' | 'Location' | 'Max-Forwards' | 'Origin' | 'Permissions-Policy' | 'Priority' | 'Proxy-Authenticate' | 'Proxy-Authorization' | 'Range' | 'Referer' | 'Referrer-Policy' | 'Retry-After' | 'Sec-Fetch-Dest' | 'Sec-Fetch-Mode' | 'Sec-Fetch-Site' | 'Sec-Fetch-User' | 'Sec-Purpose' | 'Sec-WebSocket-Accept' | 'Server' | 'Server-Timing' | 'Service-Worker-Navigation-Preload' | 'Set-Cookie' | 'SourceMap' | 'Strict-Transport-Security' | 'TE' | 'Timing-Allow-Origin' | 'Trailer' | 'Transfer-Encoding' | 'Upgrade' | 'Upgrade-Insecure-Requests' | 'User-Agent' | 'Vary' | 'Via' | 'WWW-Authenticate' | 'X-Content-Type-Options' | 'X-Frame-Options'>;
type IANARegisteredMimeType = Autocomplete<'audio/aac' | 'video/x-msvideo' | 'image/avif' | 'video/av1' | 'application/octet-stream' | 'image/bmp' | 'text/css' | 'text/csv' | 'application/vnd.ms-fontobject' | 'application/epub+zip' | 'image/gif' | 'application/gzip' | 'text/html' | 'image/x-icon' | 'text/calendar' | 'image/jpeg' | 'text/javascript' | 'application/json' | 'application/ld+json' | 'audio/x-midi' | 'audio/mpeg' | 'video/mp4' | 'video/mpeg' | 'audio/ogg' | 'video/ogg' | 'application/ogg' | 'audio/opus' | 'font/otf' | 'application/pdf' | 'image/png' | 'application/rtf' | 'image/svg+xml' | 'image/tiff' | 'video/mp2t' | 'font/ttf' | 'text/plain' | 'application/wasm' | 'video/webm' | 'audio/webm' | 'image/webp' | 'font/woff' | 'font/woff2' | 'application/xhtml+xml' | 'application/xml' | 'application/zip' | 'video/3gpp' | 'video/3gpp2' | 'model/gltf+json' | 'model/gltf-binary'>;
type KnownHeaderValues = {
  'content-type': IANARegisteredMimeType;
};
type HeaderRecord = { [K in HeaderNames | Lowercase<HeaderNames>]?: Lowercase<K> extends keyof KnownHeaderValues ? KnownHeaderValues[Lowercase<K>] : string };
//#endregion
//#region ../../node_modules/.pnpm/undici@7.19.1/node_modules/undici/types/readable.d.ts
declare class BodyReadable extends Readable {
  constructor(opts: {
    resume: (this: Readable, size: number) => void | null;
    abort: () => void | null;
    contentType?: string;
    contentLength?: number;
    highWaterMark?: number;
  });
  /** Consumes and returns the body as a string
   *  https://fetch.spec.whatwg.org/#dom-body-text
   */
  text(): Promise<string>;
  /** Consumes and returns the body as a JavaScript Object
   *  https://fetch.spec.whatwg.org/#dom-body-json
   */
  json(): Promise<unknown>;
  /** Consumes and returns the body as a Blob
   *  https://fetch.spec.whatwg.org/#dom-body-blob
   */
  blob(): Promise<Blob$1>;
  /** Consumes and returns the body as an Uint8Array
   *  https://fetch.spec.whatwg.org/#dom-body-bytes
   */
  bytes(): Promise<Uint8Array>;
  /** Consumes and returns the body as an ArrayBuffer
   *  https://fetch.spec.whatwg.org/#dom-body-arraybuffer
   */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Not implemented
   *
   *  https://fetch.spec.whatwg.org/#dom-body-formdata
   */
  formData(): Promise<never>;
  /** Returns true if the body is not null and the body has been consumed
   *
   *  Otherwise, returns false
   *
   * https://fetch.spec.whatwg.org/#dom-body-bodyused
   */
  readonly bodyUsed: boolean;
  /**
   * If body is null, it should return null as the body
   *
   *  If body is not null, should return the body as a ReadableStream
   *
   *  https://fetch.spec.whatwg.org/#dom-body-body
   */
  readonly body: never | undefined;
  /** Dumps the response body by reading `limit` number of bytes.
   * @param opts.limit Number of bytes to read (optional) - Default: 131072
   * @param opts.signal AbortSignal to cancel the operation (optional)
   */
  dump(opts?: {
    limit: number;
    signal?: AbortSignal;
  }): Promise<void>;
}
//#endregion
//#region ../../node_modules/.pnpm/undici@7.19.1/node_modules/undici/types/fetch.d.ts
type BodyInit = ArrayBuffer | AsyncIterable<Uint8Array> | Blob$1 | FormData | Iterable<Uint8Array> | NodeJS.ArrayBufferView | URLSearchParams | null | string;
interface SpecIterator<T, TReturn = any, TNext = undefined> {
  next(...args: [] | [TNext]): IteratorResult<T, TReturn>;
}
interface SpecIterableIterator<T> extends SpecIterator<T> {
  [Symbol.iterator](): SpecIterableIterator<T>;
}
interface SpecIterable<T> {
  [Symbol.iterator](): SpecIterator<T>;
}
type HeadersInit = [string, string][] | HeaderRecord | Headers$1;
declare class Headers$1 implements SpecIterable<[string, string]> {
  constructor(init?: HeadersInit);
  readonly append: (name: string, value: string) => void;
  readonly delete: (name: string) => void;
  readonly get: (name: string) => string | null;
  readonly has: (name: string) => boolean;
  readonly set: (name: string, value: string) => void;
  readonly getSetCookie: () => string[];
  readonly forEach: (callbackfn: (value: string, key: string, iterable: Headers$1) => void, thisArg?: unknown) => void;
  readonly keys: () => SpecIterableIterator<string>;
  readonly values: () => SpecIterableIterator<string>;
  readonly entries: () => SpecIterableIterator<[string, string]>;
  readonly [Symbol.iterator]: () => SpecIterableIterator<[string, string]>;
}
//#endregion
//#region ../../node_modules/.pnpm/undici@7.19.1/node_modules/undici/types/formdata.d.ts
/**
 * A `string` or `File` that represents a single value from a set of `FormData` key-value pairs.
 */
declare type FormDataEntryValue = string | File;
/**
 * Provides a way to easily construct a set of key/value pairs representing form fields and their values, which can then be easily sent using fetch().
 */
declare class FormData {
  /**
   * Appends a new value onto an existing key inside a FormData object,
   * or adds the key if it does not already exist.
   *
   * The difference between `set()` and `append()` is that if the specified key already exists, `set()` will overwrite all existing values with the new one, whereas `append()` will append the new value onto the end of the existing set of values.
   *
   * @param name The name of the field whose data is contained in `value`.
   * @param value The field's value. This can be [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
    or [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File). If none of these are specified the value is converted to a string.
   * @param fileName The filename reported to the server, when a Blob or File is passed as the second parameter. The default filename for Blob objects is "blob". The default filename for File objects is the file's filename.
   */
  append(name: string, value: unknown, fileName?: string): void;
  /**
   * Set a new value for an existing key inside FormData,
   * or add the new field if it does not already exist.
   *
   * @param name The name of the field whose data is contained in `value`.
   * @param value The field's value. This can be [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
    or [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File). If none of these are specified the value is converted to a string.
   * @param fileName The filename reported to the server, when a Blob or File is passed as the second parameter. The default filename for Blob objects is "blob". The default filename for File objects is the file's filename.
   *
   */
  set(name: string, value: unknown, fileName?: string): void;
  /**
   * Returns the first value associated with a given key from within a `FormData` object.
   * If you expect multiple values and want all of them, use the `getAll()` method instead.
   *
   * @param {string} name A name of the value you want to retrieve.
   *
   * @returns A `FormDataEntryValue` containing the value. If the key doesn't exist, the method returns null.
   */
  get(name: string): FormDataEntryValue | null;
  /**
   * Returns all the values associated with a given key from within a `FormData` object.
   *
   * @param {string} name A name of the value you want to retrieve.
   *
   * @returns An array of `FormDataEntryValue` whose key matches the value passed in the `name` parameter. If the key doesn't exist, the method returns an empty list.
   */
  getAll(name: string): FormDataEntryValue[];
  /**
   * Returns a boolean stating whether a `FormData` object contains a certain key.
   *
   * @param name A string representing the name of the key you want to test for.
   *
   * @return A boolean value.
   */
  has(name: string): boolean;
  /**
   * Deletes a key and its value(s) from a `FormData` object.
   *
   * @param name The name of the key you want to delete.
   */
  delete(name: string): void;
  /**
   * Executes given callback function for each field of the FormData instance
   */
  forEach: (callbackfn: (value: FormDataEntryValue, key: string, iterable: FormData) => void, thisArg?: unknown) => void;
  /**
   * Returns an [`iterator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols) allowing to go through all keys contained in this `FormData` object.
   * Each key is a `string`.
   */
  keys: () => SpecIterableIterator<string>;
  /**
   * Returns an [`iterator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols) allowing to go through all values contained in this object `FormData` object.
   * Each value is a [`FormDataValue`](https://developer.mozilla.org/en-US/docs/Web/API/FormDataEntryValue).
   */
  values: () => SpecIterableIterator<FormDataEntryValue>;
  /**
   * Returns an [`iterator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols) allowing to go through the `FormData` key/value pairs.
   * The key of each pair is a string; the value is a [`FormDataValue`](https://developer.mozilla.org/en-US/docs/Web/API/FormDataEntryValue).
   */
  entries: () => SpecIterableIterator<[string, FormDataEntryValue]>;
  /**
   * An alias for FormData#entries()
   */
  [Symbol.iterator]: () => SpecIterableIterator<[string, FormDataEntryValue]>;
  readonly [Symbol.toStringTag]: string;
}
//#endregion
//#region ../../node_modules/.pnpm/undici@7.19.1/node_modules/undici/types/connector.d.ts
declare function buildConnector(options?: buildConnector.BuildOptions): buildConnector.connector;
declare namespace buildConnector {
  export type BuildOptions = (ConnectionOptions | TcpNetConnectOpts | IpcNetConnectOpts) & {
    allowH2?: boolean;
    maxCachedSessions?: number | null;
    socketPath?: string | null;
    timeout?: number | null;
    port?: number;
    keepAlive?: boolean | null;
    keepAliveInitialDelay?: number | null;
  };
  export interface Options {
    hostname: string;
    host?: string;
    protocol: string;
    port: string;
    servername?: string;
    localAddress?: string | null;
    httpSocket?: Socket;
  }
  export type Callback = (...args: CallbackArgs) => void;
  type CallbackArgs = [null, Socket | TLSSocket] | [Error, null];
  export interface connector {
    (options: buildConnector.Options, callback: buildConnector.Callback): void;
  }
}
//#endregion
//#region ../../node_modules/.pnpm/undici@7.19.1/node_modules/undici/types/client-stats.d.ts
declare class ClientStats {
  constructor(pool: Client);
  /** If socket has open connection. */
  connected: boolean;
  /** Number of open socket connections in this client that do not have an active request. */
  pending: number;
  /** Number of currently active requests of this client. */
  running: number;
  /** Number of active, pending, or queued requests of this client. */
  size: number;
}
//#endregion
//#region ../../node_modules/.pnpm/undici@7.19.1/node_modules/undici/types/client.d.ts
type ClientConnectOptions = Omit<Dispatcher.ConnectOptions, 'origin'>;
/**
 * A basic HTTP/1.1 client, mapped on top a single TCP/TLS connection. Pipelining is disabled by default.
 */
declare class Client extends Dispatcher {
  constructor(url: string | URL$1, options?: Client.Options);
  /** Property to get and set the pipelining factor. */
  pipelining: number;
  /** `true` after `client.close()` has been called. */
  closed: boolean;
  /** `true` after `client.destroyed()` has been called or `client.close()` has been called and the client shutdown has completed. */
  destroyed: boolean;
  /** Aggregate stats for a Client. */
  readonly stats: ClientStats; // Override dispatcher APIs.
  override connect(options: ClientConnectOptions): Promise<Dispatcher.ConnectData>;
  override connect(options: ClientConnectOptions, callback: (err: Error | null, data: Dispatcher.ConnectData) => void): void;
}
declare namespace Client {
  export interface OptionsInterceptors {
    Client: readonly Dispatcher.DispatchInterceptor[];
  }
  export interface Options {
    /** TODO */
    interceptors?: OptionsInterceptors;
    /** The maximum length of request headers in bytes. Default: Node.js' `--max-http-header-size` or `16384` (16KiB). */
    maxHeaderSize?: number;
    /** The amount of time, in milliseconds, the parser will wait to receive the complete HTTP headers (Node 14 and above only). Default: `300e3` milliseconds (300s). */
    headersTimeout?: number;
    /** @deprecated unsupported socketTimeout, use headersTimeout & bodyTimeout instead */
    socketTimeout?: never;
    /** @deprecated unsupported requestTimeout, use headersTimeout & bodyTimeout instead */
    requestTimeout?: never;
    /** TODO */
    connectTimeout?: number;
    /** The timeout after which a request will time out, in milliseconds. Monitors time between receiving body data. Use `0` to disable it entirely. Default: `300e3` milliseconds (300s). */
    bodyTimeout?: number;
    /** @deprecated unsupported idleTimeout, use keepAliveTimeout instead */
    idleTimeout?: never;
    /** @deprecated unsupported keepAlive, use pipelining=0 instead */
    keepAlive?: never;
    /** the timeout, in milliseconds, after which a socket without active requests will time out. Monitors time between activity on a connected socket. This value may be overridden by *keep-alive* hints from the server. Default: `4e3` milliseconds (4s). */
    keepAliveTimeout?: number;
    /** @deprecated unsupported maxKeepAliveTimeout, use keepAliveMaxTimeout instead */
    maxKeepAliveTimeout?: never;
    /** the maximum allowed `idleTimeout`, in milliseconds, when overridden by *keep-alive* hints from the server. Default: `600e3` milliseconds (10min). */
    keepAliveMaxTimeout?: number;
    /** A number of milliseconds subtracted from server *keep-alive* hints when overriding `idleTimeout` to account for timing inaccuracies caused by e.g. transport latency. Default: `1e3` milliseconds (1s). */
    keepAliveTimeoutThreshold?: number;
    /** TODO */
    socketPath?: string;
    /** The amount of concurrent requests to be sent over the single TCP/TLS connection according to [RFC7230](https://tools.ietf.org/html/rfc7230#section-6.3.2). Default: `1`. */
    pipelining?: number;
    /** @deprecated use the connect option instead */
    tls?: never;
    /** If `true`, an error is thrown when the request content-length header doesn't match the length of the request body. Default: `true`. */
    strictContentLength?: boolean;
    /** TODO */
    maxCachedSessions?: number;
    /** TODO */
    connect?: Partial<buildConnector.BuildOptions> | buildConnector.connector;
    /** TODO */
    maxRequestsPerClient?: number;
    /** TODO */
    localAddress?: string;
    /** Max response body size in bytes, -1 is disabled */
    maxResponseSize?: number;
    /** Enables a family autodetection algorithm that loosely implements section 5 of RFC 8305. */
    autoSelectFamily?: boolean;
    /** The amount of time in milliseconds to wait for a connection attempt to finish before trying the next address when using the `autoSelectFamily` option. */
    autoSelectFamilyAttemptTimeout?: number;
    /**
     * @description Enables support for H2 if the server has assigned bigger priority to it through ALPN negotiation.
     * @default false
     */
    allowH2?: boolean;
    /**
     * @description Dictates the maximum number of concurrent streams for a single H2 session. It can be overridden by a SETTINGS remote frame.
     * @default 100
     */
    maxConcurrentStreams?: number;
    /**
     * @description Sets the HTTP/2 stream-level flow-control window size (SETTINGS_INITIAL_WINDOW_SIZE).
     * @default 262144
     */
    initialWindowSize?: number;
    /**
     * @description Sets the HTTP/2 connection-level flow-control window size (ClientHttp2Session.setLocalWindowSize).
     * @default 524288
     */
    connectionWindowSize?: number;
  }
  export interface SocketInfo {
    localAddress?: string;
    localPort?: number;
    remoteAddress?: string;
    remotePort?: number;
    remoteFamily?: string;
    timeout?: number;
    bytesWritten?: number;
    bytesRead?: number;
  }
}
//#endregion
//#region ../../node_modules/.pnpm/undici@7.19.1/node_modules/undici/types/errors.d.ts
declare namespace Errors {
  export class UndiciError extends Error {
    name: string;
    code: string;
  }
  /** Connect timeout error. */
  export class ConnectTimeoutError extends UndiciError {
    name: 'ConnectTimeoutError';
    code: 'UND_ERR_CONNECT_TIMEOUT';
  }
  /** A header exceeds the `headersTimeout` option. */
  export class HeadersTimeoutError extends UndiciError {
    name: 'HeadersTimeoutError';
    code: 'UND_ERR_HEADERS_TIMEOUT';
  }
  /** Headers overflow error. */
  export class HeadersOverflowError extends UndiciError {
    name: 'HeadersOverflowError';
    code: 'UND_ERR_HEADERS_OVERFLOW';
  }
  /** A body exceeds the `bodyTimeout` option. */
  export class BodyTimeoutError extends UndiciError {
    name: 'BodyTimeoutError';
    code: 'UND_ERR_BODY_TIMEOUT';
  }
  export class ResponseError extends UndiciError {
    constructor(message: string, code: number, options: {
      headers?: IncomingHttpHeaders | string[] | null;
      body?: null | Record<string, any> | string;
    });
    name: 'ResponseError';
    code: 'UND_ERR_RESPONSE';
    statusCode: number;
    body: null | Record<string, any> | string;
    headers: IncomingHttpHeaders | string[] | null;
  }
  /** Passed an invalid argument. */
  export class InvalidArgumentError extends UndiciError {
    name: 'InvalidArgumentError';
    code: 'UND_ERR_INVALID_ARG';
  }
  /** Returned an invalid value. */
  export class InvalidReturnValueError extends UndiciError {
    name: 'InvalidReturnValueError';
    code: 'UND_ERR_INVALID_RETURN_VALUE';
  }
  /** The request has been aborted by the user. */
  export class RequestAbortedError extends UndiciError {
    name: 'AbortError';
    code: 'UND_ERR_ABORTED';
  }
  /** Expected error with reason. */
  export class InformationalError extends UndiciError {
    name: 'InformationalError';
    code: 'UND_ERR_INFO';
  }
  /** Request body length does not match content-length header. */
  export class RequestContentLengthMismatchError extends UndiciError {
    name: 'RequestContentLengthMismatchError';
    code: 'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH';
  }
  /** Response body length does not match content-length header. */
  export class ResponseContentLengthMismatchError extends UndiciError {
    name: 'ResponseContentLengthMismatchError';
    code: 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH';
  }
  /** Trying to use a destroyed client. */
  export class ClientDestroyedError extends UndiciError {
    name: 'ClientDestroyedError';
    code: 'UND_ERR_DESTROYED';
  }
  /** Trying to use a closed client. */
  export class ClientClosedError extends UndiciError {
    name: 'ClientClosedError';
    code: 'UND_ERR_CLOSED';
  }
  /** There is an error with the socket. */
  export class SocketError extends UndiciError {
    name: 'SocketError';
    code: 'UND_ERR_SOCKET';
    socket: Client.SocketInfo | null;
  }
  /** Encountered unsupported functionality. */
  export class NotSupportedError extends UndiciError {
    name: 'NotSupportedError';
    code: 'UND_ERR_NOT_SUPPORTED';
  }
  /** No upstream has been added to the BalancedPool. */
  export class BalancedPoolMissingUpstreamError extends UndiciError {
    name: 'MissingUpstreamError';
    code: 'UND_ERR_BPL_MISSING_UPSTREAM';
  }
  export class HTTPParserError extends UndiciError {
    name: 'HTTPParserError';
    code: string;
  }
  /** The response exceed the length allowed. */
  export class ResponseExceededMaxSizeError extends UndiciError {
    name: 'ResponseExceededMaxSizeError';
    code: 'UND_ERR_RES_EXCEEDED_MAX_SIZE';
  }
  export class RequestRetryError extends UndiciError {
    constructor(message: string, statusCode: number, headers?: IncomingHttpHeaders | string[] | null, body?: null | Record<string, any> | string);
    name: 'RequestRetryError';
    code: 'UND_ERR_REQ_RETRY';
    statusCode: number;
    data: {
      count: number;
    };
    headers: Record<string, string | string[]>;
  }
  export class SecureProxyConnectionError extends UndiciError {
    constructor(cause?: Error, message?: string, options?: Record<any, any>);
    name: 'SecureProxyConnectionError';
    code: 'UND_ERR_PRX_TLS';
  }
  class MaxOriginsReachedError extends UndiciError {
    name: 'MaxOriginsReachedError';
    code: 'UND_ERR_MAX_ORIGINS_REACHED';
  }
}
//#endregion
//#region ../../node_modules/.pnpm/undici@7.19.1/node_modules/undici/types/dispatcher.d.ts
type AbortSignal$1 = unknown;
type UndiciHeaders = Record<string, string | string[]> | IncomingHttpHeaders | string[] | Iterable<[string, string | string[] | undefined]> | null;
/** Dispatcher is the core API used to dispatch requests. */
declare class Dispatcher extends EventEmitter {
  /** Dispatches a request. This API is expected to evolve through semver-major versions and is less stable than the preceding higher level APIs. It is primarily intended for library developers who implement higher level APIs on top of this. */
  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean;
  /** Starts two-way communications with the requested resource. */
  connect<TOpaque = null>(options: Dispatcher.ConnectOptions<TOpaque>, callback: (err: Error | null, data: Dispatcher.ConnectData<TOpaque>) => void): void;
  connect<TOpaque = null>(options: Dispatcher.ConnectOptions<TOpaque>): Promise<Dispatcher.ConnectData<TOpaque>>;
  /** Compose a chain of dispatchers */
  compose(dispatchers: Dispatcher.DispatcherComposeInterceptor[]): Dispatcher.ComposedDispatcher;
  compose(...dispatchers: Dispatcher.DispatcherComposeInterceptor[]): Dispatcher.ComposedDispatcher;
  /** Performs an HTTP request. */
  request<TOpaque = null>(options: Dispatcher.RequestOptions<TOpaque>, callback: (err: Error | null, data: Dispatcher.ResponseData<TOpaque>) => void): void;
  request<TOpaque = null>(options: Dispatcher.RequestOptions<TOpaque>): Promise<Dispatcher.ResponseData<TOpaque>>;
  /** For easy use with `stream.pipeline`. */
  pipeline<TOpaque = null>(options: Dispatcher.PipelineOptions<TOpaque>, handler: Dispatcher.PipelineHandler<TOpaque>): Duplex;
  /** A faster version of `Dispatcher.request`. */
  stream<TOpaque = null>(options: Dispatcher.RequestOptions<TOpaque>, factory: Dispatcher.StreamFactory<TOpaque>, callback: (err: Error | null, data: Dispatcher.StreamData<TOpaque>) => void): void;
  stream<TOpaque = null>(options: Dispatcher.RequestOptions<TOpaque>, factory: Dispatcher.StreamFactory<TOpaque>): Promise<Dispatcher.StreamData<TOpaque>>;
  /** Upgrade to a different protocol. */
  upgrade(options: Dispatcher.UpgradeOptions, callback: (err: Error | null, data: Dispatcher.UpgradeData) => void): void;
  upgrade(options: Dispatcher.UpgradeOptions): Promise<Dispatcher.UpgradeData>;
  /** Closes the client and gracefully waits for enqueued requests to complete before invoking the callback (or returning a promise if no callback is provided). */
  close(callback: () => void): void;
  close(): Promise<void>;
  /** Destroy the client abruptly with the given err. All the pending and running requests will be asynchronously aborted and error. Waits until socket is closed before invoking the callback (or returning a promise if no callback is provided). Since this operation is asynchronously dispatched there might still be some progress on dispatched requests. */
  destroy(err: Error | null, callback: () => void): void;
  destroy(callback: () => void): void;
  destroy(err: Error | null): Promise<void>;
  destroy(): Promise<void>;
  on(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  on(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  on(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  on(eventName: 'drain', callback: (origin: URL$1) => void): this;
  once(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  once(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  once(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  once(eventName: 'drain', callback: (origin: URL$1) => void): this;
  off(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  off(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  off(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  off(eventName: 'drain', callback: (origin: URL$1) => void): this;
  addListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  addListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  addListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  addListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  removeListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  removeListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  removeListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  removeListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  prependListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  prependListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  prependListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  prependListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  prependOnceListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  prependOnceListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  prependOnceListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  prependOnceListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  listeners(eventName: 'connect'): ((origin: URL$1, targets: readonly Dispatcher[]) => void)[];
  listeners(eventName: 'disconnect'): ((origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void)[];
  listeners(eventName: 'connectionError'): ((origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void)[];
  listeners(eventName: 'drain'): ((origin: URL$1) => void)[];
  rawListeners(eventName: 'connect'): ((origin: URL$1, targets: readonly Dispatcher[]) => void)[];
  rawListeners(eventName: 'disconnect'): ((origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void)[];
  rawListeners(eventName: 'connectionError'): ((origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void)[];
  rawListeners(eventName: 'drain'): ((origin: URL$1) => void)[];
  emit(eventName: 'connect', origin: URL$1, targets: readonly Dispatcher[]): boolean;
  emit(eventName: 'disconnect', origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError): boolean;
  emit(eventName: 'connectionError', origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError): boolean;
  emit(eventName: 'drain', origin: URL$1): boolean;
}
declare namespace Dispatcher {
  export interface ComposedDispatcher extends Dispatcher {}
  export type Dispatch = Dispatcher['dispatch'];
  export type DispatcherComposeInterceptor = (dispatch: Dispatch) => Dispatch;
  export interface DispatchOptions {
    origin?: string | URL$1;
    path: string;
    method: HttpMethod;
    /** Default: `null` */
    body?: string | Buffer | Uint8Array | Readable | null | FormData;
    /** Default: `null` */
    headers?: UndiciHeaders;
    /** Query string params to be embedded in the request URL. Default: `null` */
    query?: Record<string, any>;
    /** Whether the requests can be safely retried or not. If `false` the request won't be sent until all preceding requests in the pipeline have completed. Default: `true` if `method` is `HEAD` or `GET`. */
    idempotent?: boolean;
    /** Whether the response is expected to take a long time and would end up blocking the pipeline. When this is set to `true` further pipelining will be avoided on the same connection until headers have been received. Defaults to `method !== 'HEAD'`. */
    blocking?: boolean;
    /** Upgrade the request. Should be used to specify the kind of upgrade i.e. `'Websocket'`. Default: `method === 'CONNECT' || null`. */
    upgrade?: boolean | string | null;
    /** The amount of time, in milliseconds, the parser will wait to receive the complete HTTP headers. Defaults to 300 seconds. */
    headersTimeout?: number | null;
    /** The timeout after which a request will time out, in milliseconds. Monitors time between receiving body data. Use 0 to disable it entirely. Defaults to 300 seconds. */
    bodyTimeout?: number | null;
    /** Whether the request should stablish a keep-alive or not. Default `false` */
    reset?: boolean;
    /** Whether Undici should throw an error upon receiving a 4xx or 5xx response from the server. Defaults to false */
    throwOnError?: boolean;
    /** For H2, it appends the expect: 100-continue header, and halts the request body until a 100-continue is received from the remote server */
    expectContinue?: boolean;
  }
  export interface ConnectOptions<TOpaque = null> {
    origin: string | URL$1;
    path: string;
    /** Default: `null` */
    headers?: UndiciHeaders;
    /** Default: `null` */
    signal?: AbortSignal$1 | EventEmitter | null;
    /** This argument parameter is passed through to `ConnectData` */
    opaque?: TOpaque;
    /** Default: false */
    redirectionLimitReached?: boolean;
    /** Default: `null` */
    responseHeaders?: 'raw' | null;
  }
  export interface RequestOptions<TOpaque = null> extends DispatchOptions {
    /** Default: `null` */
    opaque?: TOpaque;
    /** Default: `null` */
    signal?: AbortSignal$1 | EventEmitter | null;
    /** Default: false */
    redirectionLimitReached?: boolean;
    /** Default: `null` */
    onInfo?: (info: {
      statusCode: number;
      headers: Record<string, string | string[]>;
    }) => void;
    /** Default: `null` */
    responseHeaders?: 'raw' | null;
    /** Default: `64 KiB` */
    highWaterMark?: number;
  }
  export interface PipelineOptions<TOpaque = null> extends RequestOptions<TOpaque> {
    /** `true` if the `handler` will return an object stream. Default: `false` */
    objectMode?: boolean;
  }
  export interface UpgradeOptions {
    path: string;
    /** Default: `'GET'` */
    method?: string;
    /** Default: `null` */
    headers?: UndiciHeaders;
    /** A string of comma separated protocols, in descending preference order. Default: `'Websocket'` */
    protocol?: string;
    /** Default: `null` */
    signal?: AbortSignal$1 | EventEmitter | null;
    /** Default: false */
    redirectionLimitReached?: boolean;
    /** Default: `null` */
    responseHeaders?: 'raw' | null;
  }
  export interface ConnectData<TOpaque = null> {
    statusCode: number;
    headers: IncomingHttpHeaders;
    socket: Duplex;
    opaque: TOpaque;
  }
  export interface ResponseData<TOpaque = null> {
    statusCode: number;
    headers: IncomingHttpHeaders;
    body: BodyReadable & BodyMixin;
    trailers: Record<string, string>;
    opaque: TOpaque;
    context: object;
  }
  export interface PipelineHandlerData<TOpaque = null> {
    statusCode: number;
    headers: IncomingHttpHeaders;
    opaque: TOpaque;
    body: BodyReadable;
    context: object;
  }
  export interface StreamData<TOpaque = null> {
    opaque: TOpaque;
    trailers: Record<string, string>;
  }
  export interface UpgradeData<TOpaque = null> {
    headers: IncomingHttpHeaders;
    socket: Duplex;
    opaque: TOpaque;
  }
  export interface StreamFactoryData<TOpaque = null> {
    statusCode: number;
    headers: IncomingHttpHeaders;
    opaque: TOpaque;
    context: object;
  }
  export type StreamFactory<TOpaque = null> = (data: StreamFactoryData<TOpaque>) => Writable;
  export interface DispatchController {
    get aborted(): boolean;
    get paused(): boolean;
    get reason(): Error | null;
    abort(reason: Error): void;
    pause(): void;
    resume(): void;
  }
  export interface DispatchHandler {
    onRequestStart?(controller: DispatchController, context: any): void;
    onRequestUpgrade?(controller: DispatchController, statusCode: number, headers: IncomingHttpHeaders, socket: Duplex): void;
    onResponseStart?(controller: DispatchController, statusCode: number, headers: IncomingHttpHeaders, statusMessage?: string): void;
    onResponseData?(controller: DispatchController, chunk: Buffer): void;
    onResponseEnd?(controller: DispatchController, trailers: IncomingHttpHeaders): void;
    onResponseError?(controller: DispatchController, error: Error): void;
    /** Invoked before request is dispatched on socket. May be invoked multiple times when a request is retried when the request at the head of the pipeline fails. */
    /** @deprecated */
    onConnect?(abort: (err?: Error) => void): void;
    /** Invoked when an error has occurred. */
    /** @deprecated */
    onError?(err: Error): void;
    /** Invoked when request is upgraded either due to a `Upgrade` header or `CONNECT` method. */
    /** @deprecated */
    onUpgrade?(statusCode: number, headers: Buffer[] | string[] | null, socket: Duplex): void;
    /** Invoked when response is received, before headers have been read. **/
    /** @deprecated */
    onResponseStarted?(): void;
    /** Invoked when statusCode and headers have been received. May be invoked multiple times due to 1xx informational headers. */
    /** @deprecated */
    onHeaders?(statusCode: number, headers: Buffer[], resume: () => void, statusText: string): boolean;
    /** Invoked when response payload data is received. */
    /** @deprecated */
    onData?(chunk: Buffer): boolean;
    /** Invoked when response payload and trailers have been received and the request has completed. */
    /** @deprecated */
    onComplete?(trailers: string[] | null): void;
    /** Invoked when a body chunk is sent to the server. May be invoked multiple times for chunked requests */
    /** @deprecated */
    onBodySent?(chunkSize: number, totalBytesSent: number): void;
  }
  export type PipelineHandler<TOpaque = null> = (data: PipelineHandlerData<TOpaque>) => Readable;
  export type HttpMethod = Autocomplete<'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'PATCH'>;
  /**
   * @link https://fetch.spec.whatwg.org/#body-mixin
   */
  interface BodyMixin {
    readonly body?: never;
    readonly bodyUsed: boolean;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob$1>;
    bytes(): Promise<Uint8Array>;
    formData(): Promise<never>;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }
  export interface DispatchInterceptor {
    (dispatch: Dispatch): Dispatch;
  }
}
//#endregion
//#region ../../node_modules/.pnpm/undici@7.19.1/node_modules/undici/types/mock-interceptor.d.ts
/** The scope associated with a mock dispatch. */
declare class MockScope<TData extends object = object> {
  constructor(mockDispatch: MockInterceptor.MockDispatch<TData>);
  /** Delay a reply by a set amount of time in ms. */
  delay(waitInMs: number): MockScope<TData>;
  /** Persist the defined mock data for the associated reply. It will return the defined mock data indefinitely. */
  persist(): MockScope<TData>;
  /** Define a reply for a set amount of matching requests. */
  times(repeatTimes: number): MockScope<TData>;
}
/** The interceptor for a Mock. */
declare class MockInterceptor {
  constructor(options: MockInterceptor.Options, mockDispatches: MockInterceptor.MockDispatch[]);
  /** Mock an undici request with the defined reply. */
  reply<TData extends object = object>(replyOptionsCallback: MockInterceptor.MockReplyOptionsCallback<TData>): MockScope<TData>;
  reply<TData extends object = object>(statusCode: number, data?: TData | Buffer | string | MockInterceptor.MockResponseDataHandler<TData>, responseOptions?: MockInterceptor.MockResponseOptions): MockScope<TData>;
  /** Mock an undici request by throwing the defined reply error. */
  replyWithError<TError extends Error = Error>(error: TError): MockScope;
  /** Set default reply headers on the interceptor for subsequent mocked replies. */
  defaultReplyHeaders(headers: IncomingHttpHeaders): MockInterceptor;
  /** Set default reply trailers on the interceptor for subsequent mocked replies. */
  defaultReplyTrailers(trailers: Record<string, string>): MockInterceptor;
  /** Set automatically calculated content-length header on subsequent mocked replies. */
  replyContentLength(): MockInterceptor;
}
declare namespace MockInterceptor {
  /** MockInterceptor options. */
  export interface Options {
    /** Path to intercept on. */
    path: string | RegExp | ((path: string) => boolean);
    /** Method to intercept on. Defaults to GET. */
    method?: string | RegExp | ((method: string) => boolean);
    /** Body to intercept on. */
    body?: string | RegExp | ((body: string) => boolean);
    /** Headers to intercept on. */
    headers?: Record<string, string | RegExp | ((body: string) => boolean)> | ((headers: Record<string, string>) => boolean);
    /** Query params to intercept on */
    query?: Record<string, any>;
  }
  export interface MockDispatch<TData extends object = object, TError extends Error = Error> extends Options {
    times: number | null;
    persist: boolean;
    consumed: boolean;
    data: MockDispatchData<TData, TError>;
  }
  export interface MockDispatchData<TData extends object = object, TError extends Error = Error> extends MockResponseOptions {
    error: TError | null;
    statusCode?: number;
    data?: TData | string;
  }
  export interface MockResponseOptions {
    headers?: IncomingHttpHeaders;
    trailers?: Record<string, string>;
  }
  export interface MockResponseCallbackOptions {
    path: string;
    method: string;
    headers?: Headers$1 | Record<string, string>;
    origin?: string;
    body?: BodyInit | Dispatcher.DispatchOptions['body'] | null;
  }
  export type MockResponseDataHandler<TData extends object = object> = (opts: MockResponseCallbackOptions) => TData | Buffer | string;
  export type MockReplyOptionsCallback<TData extends object = object> = (opts: MockResponseCallbackOptions) => {
    statusCode: number;
    data?: TData | Buffer | string;
    responseOptions?: MockResponseOptions;
  };
}
//#endregion
//#region ../../node_modules/.pnpm/unstorage@1.17.4_db0@0.3.4_ioredis@5.9.1/node_modules/unstorage/dist/shared/unstorage.Ca7R4QL2.d.mts
type StorageValue = null | string | number | boolean | object;
type WatchEvent = "update" | "remove";
type WatchCallback = (event: WatchEvent, key: string) => any;
type MaybePromise$2<T> = T | Promise<T>;
type MaybeDefined<T> = T extends any ? T : any;
type Unwatch = () => MaybePromise$2<void>;
interface StorageMeta {
  atime?: Date;
  mtime?: Date;
  ttl?: number;
  [key: string]: StorageValue | Date | undefined;
}
type TransactionOptions = Record<string, any>;
type GetKeysOptions = TransactionOptions & {
  maxDepth?: number;
};
interface DriverFlags {
  maxDepth?: boolean;
  ttl?: boolean;
}
interface Driver<OptionsT = any, InstanceT = any> {
  name?: string;
  flags?: DriverFlags;
  options?: OptionsT;
  getInstance?: () => InstanceT;
  hasItem: (key: string, opts: TransactionOptions) => MaybePromise$2<boolean>;
  getItem: (key: string, opts?: TransactionOptions) => MaybePromise$2<StorageValue>;
  /** @experimental */
  getItems?: (items: {
    key: string;
    options?: TransactionOptions;
  }[], commonOptions?: TransactionOptions) => MaybePromise$2<{
    key: string;
    value: StorageValue;
  }[]>;
  /** @experimental */
  getItemRaw?: (key: string, opts: TransactionOptions) => MaybePromise$2<unknown>;
  setItem?: (key: string, value: string, opts: TransactionOptions) => MaybePromise$2<void>;
  /** @experimental */
  setItems?: (items: {
    key: string;
    value: string;
    options?: TransactionOptions;
  }[], commonOptions?: TransactionOptions) => MaybePromise$2<void>;
  /** @experimental */
  setItemRaw?: (key: string, value: any, opts: TransactionOptions) => MaybePromise$2<void>;
  removeItem?: (key: string, opts: TransactionOptions) => MaybePromise$2<void>;
  getMeta?: (key: string, opts: TransactionOptions) => MaybePromise$2<StorageMeta | null>;
  getKeys: (base: string, opts: GetKeysOptions) => MaybePromise$2<string[]>;
  clear?: (base: string, opts: TransactionOptions) => MaybePromise$2<void>;
  dispose?: () => MaybePromise$2<void>;
  watch?: (callback: WatchCallback) => MaybePromise$2<Unwatch>;
}
type StorageDefinition = {
  items: unknown;
  [key: string]: unknown;
};
type StorageItemMap<T> = T extends StorageDefinition ? T["items"] : T;
type StorageItemType<T, K> = K extends keyof StorageItemMap<T> ? StorageItemMap<T>[K] : T extends StorageDefinition ? StorageValue : T;
interface Storage$1<T extends StorageValue = StorageValue> {
  hasItem<U extends Extract<T, StorageDefinition>, K extends keyof StorageItemMap<U>>(key: K, opts?: TransactionOptions): Promise<boolean>;
  hasItem(key: string, opts?: TransactionOptions): Promise<boolean>;
  getItem<U extends Extract<T, StorageDefinition>, K extends string & keyof StorageItemMap<U>>(key: K, ops?: TransactionOptions): Promise<StorageItemType<T, K> | null>;
  getItem<R = StorageItemType<T, string>>(key: string, opts?: TransactionOptions): Promise<R | null>;
  /** @experimental */
  getItems: <U extends T>(items: (string | {
    key: string;
    options?: TransactionOptions;
  })[], commonOptions?: TransactionOptions) => Promise<{
    key: string;
    value: U;
  }[]>;
  /** @experimental See https://github.com/unjs/unstorage/issues/142 */
  getItemRaw: <T = any>(key: string, opts?: TransactionOptions) => Promise<MaybeDefined<T> | null>;
  setItem<U extends Extract<T, StorageDefinition>, K extends keyof StorageItemMap<U>>(key: K, value: StorageItemType<T, K>, opts?: TransactionOptions): Promise<void>;
  setItem<U extends T>(key: string, value: U, opts?: TransactionOptions): Promise<void>;
  /** @experimental */
  setItems: <U extends T>(items: {
    key: string;
    value: U;
    options?: TransactionOptions;
  }[], commonOptions?: TransactionOptions) => Promise<void>;
  /** @experimental See https://github.com/unjs/unstorage/issues/142 */
  setItemRaw: <T = any>(key: string, value: MaybeDefined<T>, opts?: TransactionOptions) => Promise<void>;
  removeItem<U extends Extract<T, StorageDefinition>, K extends keyof StorageItemMap<U>>(key: K, opts?: (TransactionOptions & {
    removeMeta?: boolean;
  }) | boolean): Promise<void>;
  removeItem(key: string, opts?: (TransactionOptions & {
    removeMeta?: boolean;
  }) | boolean): Promise<void>;
  getMeta: (key: string, opts?: (TransactionOptions & {
    nativeOnly?: boolean;
  }) | boolean) => MaybePromise$2<StorageMeta>;
  setMeta: (key: string, value: StorageMeta, opts?: TransactionOptions) => Promise<void>;
  removeMeta: (key: string, opts?: TransactionOptions) => Promise<void>;
  getKeys: (base?: string, opts?: GetKeysOptions) => Promise<string[]>;
  clear: (base?: string, opts?: TransactionOptions) => Promise<void>;
  dispose: () => Promise<void>;
  watch: (callback: WatchCallback) => Promise<Unwatch>;
  unwatch: () => Promise<void>;
  mount: (base: string, driver: Driver) => Storage$1;
  unmount: (base: string, dispose?: boolean) => Promise<void>;
  getMount: (key?: string) => {
    base: string;
    driver: Driver;
  };
  getMounts: (base?: string, options?: {
    parents?: boolean;
  }) => {
    base: string;
    driver: Driver;
  }[];
  keys: Storage$1["getKeys"];
  get: Storage$1<T>["getItem"];
  set: Storage$1<T>["setItem"];
  has: Storage$1<T>["hasItem"];
  del: Storage$1<T>["removeItem"];
  remove: Storage$1<T>["removeItem"];
}
//#endregion
//#region ../../node_modules/.pnpm/unstorage@1.17.4_db0@0.3.4_ioredis@5.9.1/node_modules/unstorage/dist/index.d.mts
type BuiltinDriverName = "azure-app-configuration" | "azureAppConfiguration" | "azure-cosmos" | "azureCosmos" | "azure-key-vault" | "azureKeyVault" | "azure-storage-blob" | "azureStorageBlob" | "azure-storage-table" | "azureStorageTable" | "capacitor-preferences" | "capacitorPreferences" | "cloudflare-kv-binding" | "cloudflareKVBinding" | "cloudflare-kv-http" | "cloudflareKVHttp" | "cloudflare-r2-binding" | "cloudflareR2Binding" | "db0" | "deno-kv-node" | "denoKVNode" | "deno-kv" | "denoKV" | "fs-lite" | "fsLite" | "fs" | "github" | "http" | "indexedb" | "localstorage" | "lru-cache" | "lruCache" | "memory" | "mongodb" | "netlify-blobs" | "netlifyBlobs" | "null" | "overlay" | "planetscale" | "redis" | "s3" | "session-storage" | "sessionStorage" | "uploadthing" | "upstash" | "vercel-blob" | "vercelBlob" | "vercel-kv" | "vercelKV" | "vercel-runtime-cache" | "vercelRuntimeCache";
//#endregion
//#region ../../node_modules/.pnpm/unenv@2.0.0-rc.24/node_modules/unenv/dist/index.d.mts
/**
 * Environment defined by presets.
 */
interface Environment$1 {
  alias: Readonly<Record<string, string>>;
  inject: Readonly<Record<string, string | readonly string[] | false>>;
  polyfill: readonly string[];
  external: readonly string[];
}
/**
 * Environment returned by `defineEnv`.
 *
 * It differs from the preset's Environment as the `inject` map never contains a `false` value.
 */
interface Preset$1 extends Partial<Environment$1> {
  meta?: {
    /**
     * Preset name.
     */
    readonly name?: string;
    /**
     * Preset version.
     */
    readonly version?: string;
    /**
     * Path or URL to preset entry (used for resolving absolute paths).
     */
    readonly url?: string | URL;
  };
} //#endregion
//#region src/env.d.ts
/**
 * Configure a target environment.
 */
//#endregion
//#region ../../node_modules/.pnpm/rolldown@1.0.0-rc.3/node_modules/rolldown/dist/shared/logging-CE90D8JR.d.mts
//#region src/log/logging.d.ts
/** @inline */
type LogLevel$1 = "info" | "debug" | "warn";
/** @inline */
type LogLevelOption = LogLevel$1 | "silent";
/** @inline */
type LogLevelWithError = LogLevel$1 | "error";
interface RolldownLog {
  binding?: string;
  cause?: unknown;
  /**
  * The log code for this log object.
  * @example 'PLUGIN_ERROR'
  */
  code?: string;
  exporter?: string;
  frame?: string;
  hook?: string;
  id?: string;
  ids?: string[];
  loc?: {
    column: number;
    file?: string;
    line: number;
  };
  /**
  * The message for this log object.
  * @example 'The "transform" hook used by the output plugin "rolldown-plugin-foo" is a build time hook and will not be run for that plugin. Either this plugin cannot be used as an output plugin, or it should have an option to configure it as an output plugin.'
  */
  message: string;
  meta?: any;
  names?: string[];
  plugin?: string;
  pluginCode?: unknown;
  pos?: number;
  reexporter?: string;
  stack?: string;
  url?: string;
}
/** @inline */
type RolldownLogWithString = RolldownLog | string;
/** @category Plugin APIs */
interface RolldownError extends RolldownLog {
  name?: string;
  stack?: string;
  watchFiles?: string[];
}
type LogOrStringHandler = (level: LogLevelWithError, log: RolldownLogWithString) => void; //#endregion
//#endregion
//#region ../../node_modules/.pnpm/rolldown@1.0.0-rc.3/node_modules/rolldown/dist/shared/binding-D-XMzSaG.d.mts
interface CodegenOptions$1 {
  /**
   * Remove whitespace.
   *
   * @default true
   */
  removeWhitespace?: boolean;
}
interface CompressOptions$2 {
  /**
   * Set desired EcmaScript standard version for output.
   *
   * Set `esnext` to enable all target highering.
   *
   * Example:
   *
   * * `'es2015'`
   * * `['es2020', 'chrome58', 'edge16', 'firefox57', 'node12', 'safari11']`
   *
   * @default 'esnext'
   *
   * @see [esbuild#target](https://esbuild.github.io/api/#target)
   */
  target?: string | Array<string>;
  /**
   * Pass true to discard calls to `console.*`.
   *
   * @default false
   */
  dropConsole?: boolean;
  /**
   * Remove `debugger;` statements.
   *
   * @default true
   */
  dropDebugger?: boolean;
  /**
   * Pass `true` to drop unreferenced functions and variables.
   *
   * Simple direct variable assignments do not count as references unless set to `keep_assign`.
   * @default true
   */
  unused?: boolean | 'keep_assign';
  /** Keep function / class names. */
  keepNames?: CompressOptionsKeepNames$1;
  /**
   * Join consecutive var, let and const statements.
   *
   * @default true
   */
  joinVars?: boolean;
  /**
   * Join consecutive simple statements using the comma operator.
   *
   * `a; b` -> `a, b`
   *
   * @default true
   */
  sequences?: boolean;
  /**
   * Set of label names to drop from the code.
   *
   * Labeled statements matching these names will be removed during minification.
   *
   * @default []
   */
  dropLabels?: Array<string>;
  /** Limit the maximum number of iterations for debugging purpose. */
  maxIterations?: number;
  /** Treeshake options. */
  treeshake?: TreeShakeOptions$1;
}
interface CompressOptionsKeepNames$1 {
  /**
   * Keep function names so that `Function.prototype.name` is preserved.
   *
   * This does not guarantee that the `undefined` name is preserved.
   *
   * @default false
   */
  function: boolean;
  /**
   * Keep class names so that `Class.prototype.name` is preserved.
   *
   * This does not guarantee that the `undefined` name is preserved.
   *
   * @default false
   */
  class: boolean;
}
interface MangleOptions$1 {
  /**
   * Pass `true` to mangle names declared in the top level scope.
   *
   * @default false
   */
  toplevel?: boolean;
  /**
   * Preserve `name` property for functions and classes.
   *
   * @default false
   */
  keepNames?: boolean | MangleOptionsKeepNames$1;
  /** Debug mangled names. */
  debug?: boolean;
}
interface MangleOptionsKeepNames$1 {
  /**
   * Preserve `name` property for functions.
   *
   * @default false
   */
  function: boolean;
  /**
   * Preserve `name` property for classes.
   *
   * @default false
   */
  class: boolean;
}
interface MinifyOptions$2 {
  /** Use when minifying an ES module. */
  module?: boolean;
  compress?: boolean | CompressOptions$2;
  mangle?: boolean | MangleOptions$1;
  codegen?: boolean | CodegenOptions$1;
  sourcemap?: boolean;
}
interface TreeShakeOptions$1 {
  /**
   * Whether to respect the pure annotations.
   *
   * Pure annotations are comments that mark an expression as pure.
   * For example: @__PURE__ or #__NO_SIDE_EFFECTS__.
   *
   * @default true
   */
  annotations?: boolean;
  /**
   * Whether to treat this function call as pure.
   *
   * This function is called for normal function calls, new calls, and
   * tagged template calls.
   */
  manualPureFunctions?: Array<string>;
  /**
   * Whether property read accesses have side effects.
   *
   * @default 'always'
   */
  propertyReadSideEffects?: boolean | 'always';
  /**
   * Whether accessing a global variable has side effects.
   *
   * Accessing a non-existing global variable will throw an error.
   * Global variable may be a getter that has side effects.
   *
   * @default true
   */
  unknownGlobalSideEffects?: boolean;
  /**
   * Whether invalid import statements have side effects.
   *
   * Accessing a non-existing import name will throw an error.
   * Also import statements that cannot be resolved will throw an error.
   *
   * @default true
   */
  invalidImportSideEffects?: boolean;
}
interface ParserOptions {
  /** Treat the source text as `js`, `jsx`, `ts`, `tsx` or `dts`. */
  lang?: 'js' | 'jsx' | 'ts' | 'tsx' | 'dts';
  /** Treat the source text as `script` or `module` code. */
  sourceType?: 'script' | 'module' | 'commonjs' | 'unambiguous' | undefined;
  /**
   * Return an AST which includes TypeScript-related properties, or excludes them.
   *
   * `'js'` is default for JS / JSX files.
   * `'ts'` is default for TS / TSX files.
   * The type of the file is determined from `lang` option, or extension of provided `filename`.
   */
  astType?: 'js' | 'ts';
  /**
   * Controls whether the `range` property is included on AST nodes.
   * The `range` property is a `[number, number]` which indicates the start/end offsets
   * of the node in the file contents.
   *
   * @default false
   */
  range?: boolean;
  /**
   * Emit `ParenthesizedExpression` and `TSParenthesizedType` in AST.
   *
   * If this option is true, parenthesized expressions are represented by
   * (non-standard) `ParenthesizedExpression` and `TSParenthesizedType` nodes that
   * have a single `expression` property containing the expression inside parentheses.
   *
   * @default true
   */
  preserveParens?: boolean;
  /**
   * Produce semantic errors with an additional AST pass.
   * Semantic errors depend on symbols and scopes, where the parser does not construct.
   * This adds a small performance overhead.
   *
   * @default false
   */
  showSemanticErrors?: boolean;
}
interface CompilerAssumptions$1 {
  ignoreFunctionLength?: boolean;
  noDocumentAll?: boolean;
  objectRestNoSymbols?: boolean;
  pureGetters?: boolean;
  /**
   * When using public class fields, assume that they don't shadow any getter in the current class,
   * in its subclasses or in its superclass. Thus, it's safe to assign them rather than using
   * `Object.defineProperty`.
   *
   * For example:
   *
   * Input:
   * ```js
   * class Test {
   *  field = 2;
   *
   *  static staticField = 3;
   * }
   * ```
   *
   * When `set_public_class_fields` is `true`, the output will be:
   * ```js
   * class Test {
   *  constructor() {
   *    this.field = 2;
   *  }
   * }
   * Test.staticField = 3;
   * ```
   *
   * Otherwise, the output will be:
   * ```js
   * import _defineProperty from "@oxc-project/runtime/helpers/defineProperty";
   * class Test {
   *   constructor() {
   *     _defineProperty(this, "field", 2);
   *   }
   * }
   * _defineProperty(Test, "staticField", 3);
   * ```
   *
   * NOTE: For TypeScript, if you wanted behavior is equivalent to `useDefineForClassFields: false`, you should
   * set both `set_public_class_fields` and [`crate::TypeScriptOptions::remove_class_fields_without_initializer`]
   * to `true`.
   */
  setPublicClassFields?: boolean;
}
interface DecoratorOptions$1 {
  /**
   * Enables experimental support for decorators, which is a version of decorators that predates the TC39 standardization process.
   *
   * Decorators are a language feature which hasn’t yet been fully ratified into the JavaScript specification.
   * This means that the implementation version in TypeScript may differ from the implementation in JavaScript when it it decided by TC39.
   *
   * @see https://www.typescriptlang.org/tsconfig/#experimentalDecorators
   * @default false
   */
  legacy?: boolean;
  /**
   * Enables emitting decorator metadata.
   *
   * This option the same as [emitDecoratorMetadata](https://www.typescriptlang.org/tsconfig/#emitDecoratorMetadata)
   * in TypeScript, and it only works when `legacy` is true.
   *
   * @see https://www.typescriptlang.org/tsconfig/#emitDecoratorMetadata
   * @default false
   */
  emitDecoratorMetadata?: boolean;
}
type HelperMode$1 =
/**
* Runtime mode (default): Helper functions are imported from a runtime package.
*
* Example:
*
* ```js
* import helperName from "@oxc-project/runtime/helpers/helperName";
* helperName(...arguments);
* ```
*/
'Runtime' |
/**
 * External mode: Helper functions are accessed from a global `babelHelpers` object.
 *
 * Example:
 *
 * ```js
 * babelHelpers.helperName(...arguments);
 * ```
 */
'External';
interface Helpers$1 {
  mode?: HelperMode$1;
}
/**
 * TypeScript Isolated Declarations for Standalone DTS Emit (async)
 *
 * Note: This function can be slower than `isolatedDeclarationSync` due to the overhead of spawning a thread.
 */
interface IsolatedDeclarationsOptions$1 {
  /**
   * Do not emit declarations for code that has an @internal annotation in its JSDoc comment.
   * This is an internal compiler option; use at your own risk, because the compiler does not check that the result is valid.
   *
   * Default: `false`
   *
   * See <https://www.typescriptlang.org/tsconfig/#stripInternal>
   */
  stripInternal?: boolean;
  sourcemap?: boolean;
}
/**
 * Configure how TSX and JSX are transformed.
 *
 * @see {@link https://oxc.rs/docs/guide/usage/transformer/jsx}
 */
interface JsxOptions$1 {
  /**
   * Decides which runtime to use.
   *
   * - 'automatic' - auto-import the correct JSX factories
   * - 'classic' - no auto-import
   *
   * @default 'automatic'
   */
  runtime?: 'classic' | 'automatic';
  /**
   * Emit development-specific information, such as `__source` and `__self`.
   *
   * @default false
   */
  development?: boolean;
  /**
   * Toggles whether or not to throw an error if an XML namespaced tag name
   * is used.
   *
   * Though the JSX spec allows this, it is disabled by default since React's
   * JSX does not currently have support for it.
   *
   * @default true
   */
  throwIfNamespace?: boolean;
  /**
   * Mark JSX elements and top-level React method calls as pure for tree shaking.
   *
   * @default true
   */
  pure?: boolean;
  /**
   * Replaces the import source when importing functions.
   *
   * @default 'react'
   */
  importSource?: string;
  /**
   * Replace the function used when compiling JSX expressions. It should be a
   * qualified name (e.g. `React.createElement`) or an identifier (e.g.
   * `createElement`).
   *
   * Only used for `classic` {@link runtime}.
   *
   * @default 'React.createElement'
   */
  pragma?: string;
  /**
   * Replace the component used when compiling JSX fragments. It should be a
   * valid JSX tag name.
   *
   * Only used for `classic` {@link runtime}.
   *
   * @default 'React.Fragment'
   */
  pragmaFrag?: string;
  /**
   * Enable React Fast Refresh .
   *
   * Conforms to the implementation in {@link https://github.com/facebook/react/tree/v18.3.1/packages/react-refresh}
   *
   * @default false
   */
  refresh?: boolean | ReactRefreshOptions$1;
}
/**
 * Transform JavaScript code to a Vite Node runnable module.
 *
 * @param filename The name of the file being transformed.
 * @param sourceText the source code itself
 * @param options The options for the transformation. See {@link
 * ModuleRunnerTransformOptions} for more information.
 *
 * @returns an object containing the transformed code, source maps, and any
 * errors that occurred during parsing or transformation.
 *
 * Note: This function can be slower than `moduleRunnerTransformSync` due to the overhead of spawning a thread.
 *
 * @deprecated Only works for Vite.
 */
interface PluginsOptions$1 {
  styledComponents?: StyledComponentsOptions$1;
  taggedTemplateEscape?: boolean;
}
interface ReactRefreshOptions$1 {
  /**
   * Specify the identifier of the refresh registration variable.
   *
   * @default `$RefreshReg$`.
   */
  refreshReg?: string;
  /**
   * Specify the identifier of the refresh signature variable.
   *
   * @default `$RefreshSig$`.
   */
  refreshSig?: string;
  emitFullSignatures?: boolean;
}
/**
 * Configure how styled-components are transformed.
 *
 * @see {@link https://oxc.rs/docs/guide/usage/transformer/plugins#styled-components}
 */
interface StyledComponentsOptions$1 {
  /**
   * Enhances the attached CSS class name on each component with richer output to help
   * identify your components in the DOM without React DevTools.
   *
   * @default true
   */
  displayName?: boolean;
  /**
   * Controls whether the `displayName` of a component will be prefixed with the filename
   * to make the component name as unique as possible.
   *
   * @default true
   */
  fileName?: boolean;
  /**
   * Adds a unique identifier to every styled component to avoid checksum mismatches
   * due to different class generation on the client and server during server-side rendering.
   *
   * @default true
   */
  ssr?: boolean;
  /**
   * Transpiles styled-components tagged template literals to a smaller representation
   * than what Babel normally creates, helping to reduce bundle size.
   *
   * @default true
   */
  transpileTemplateLiterals?: boolean;
  /**
   * Minifies CSS content by removing all whitespace and comments from your CSS,
   * keeping valuable bytes out of your bundles.
   *
   * @default true
   */
  minify?: boolean;
  /**
   * Enables transformation of JSX `css` prop when using styled-components.
   *
   * **Note: This feature is not yet implemented in oxc.**
   *
   * @default true
   */
  cssProp?: boolean;
  /**
   * Enables "pure annotation" to aid dead code elimination by bundlers.
   *
   * @default false
   */
  pure?: boolean;
  /**
   * Adds a namespace prefix to component identifiers to ensure class names are unique.
   *
   * Example: With `namespace: "my-app"`, generates `componentId: "my-app__sc-3rfj0a-1"`
   */
  namespace?: string;
  /**
   * List of file names that are considered meaningless for component naming purposes.
   *
   * When the `fileName` option is enabled and a component is in a file with a name
   * from this list, the directory name will be used instead of the file name for
   * the component's display name.
   *
   * @default `["index"]`
   */
  meaninglessFileNames?: Array<string>;
  /**
   * Import paths to be considered as styled-components imports at the top level.
   *
   * **Note: This feature is not yet implemented in oxc.**
   */
  topLevelImportPaths?: Array<string>;
}
/**
 * Transpile a JavaScript or TypeScript into a target ECMAScript version, asynchronously.
 *
 * Note: This function can be slower than `transform` due to the overhead of spawning a thread.
 *
 * @param filename The name of the file being transformed. If this is a
 * relative path, consider setting the {@link TransformOptions#cwd} option.
 * @param sourceText the source code itself
 * @param options The options for the transformation. See {@link
 * TransformOptions} for more information.
 *
 * @returns a promise that resolves to an object containing the transformed code,
 * source maps, and any errors that occurred during parsing or transformation.
 */
/**
 * Options for transforming a JavaScript or TypeScript file.
 *
 * @see {@link transform}
 */
interface TransformOptions$2 {
  /** Treat the source text as `js`, `jsx`, `ts`, `tsx`, or `dts`. */
  lang?: 'js' | 'jsx' | 'ts' | 'tsx' | 'dts';
  /** Treat the source text as `script` or `module` code. */
  sourceType?: 'script' | 'module' | 'commonjs' | 'unambiguous' | undefined;
  /**
   * The current working directory. Used to resolve relative paths in other
   * options.
   */
  cwd?: string;
  /**
   * Enable source map generation.
   *
   * When `true`, the `sourceMap` field of transform result objects will be populated.
   *
   * @default false
   *
   * @see {@link SourceMap}
   */
  sourcemap?: boolean;
  /** Set assumptions in order to produce smaller output. */
  assumptions?: CompilerAssumptions$1;
  /**
   * Configure how TypeScript is transformed.
   * @see {@link https://oxc.rs/docs/guide/usage/transformer/typescript}
   */
  typescript?: TypeScriptOptions$1;
  /**
   * Configure how TSX and JSX are transformed.
   * @see {@link https://oxc.rs/docs/guide/usage/transformer/jsx}
   */
  jsx?: 'preserve' | JsxOptions$1;
  /**
   * Sets the target environment for the generated JavaScript.
   *
   * The lowest target is `es2015`.
   *
   * Example:
   *
   * * `'es2015'`
   * * `['es2020', 'chrome58', 'edge16', 'firefox57', 'node12', 'safari11']`
   *
   * @default `esnext` (No transformation)
   *
   * @see {@link https://oxc.rs/docs/guide/usage/transformer/lowering#target}
   */
  target?: string | Array<string>;
  /** Behaviour for runtime helpers. */
  helpers?: Helpers$1;
  /**
   * Define Plugin
   * @see {@link https://oxc.rs/docs/guide/usage/transformer/global-variable-replacement#define}
   */
  define?: Record<string, string>;
  /**
   * Inject Plugin
   * @see {@link https://oxc.rs/docs/guide/usage/transformer/global-variable-replacement#inject}
   */
  inject?: Record<string, string | [string, string]>;
  /** Decorator plugin */
  decorator?: DecoratorOptions$1;
  /**
   * Third-party plugins to use.
   * @see {@link https://oxc.rs/docs/guide/usage/transformer/plugins}
   */
  plugins?: PluginsOptions$1;
}
interface TypeScriptOptions$1 {
  jsxPragma?: string;
  jsxPragmaFrag?: string;
  onlyRemoveTypeImports?: boolean;
  allowNamespaces?: boolean;
  /**
   * When enabled, type-only class fields are only removed if they are prefixed with the declare modifier:
   *
   * @deprecated
   *
   * Allowing `declare` fields is built-in support in Oxc without any option. If you want to remove class fields
   * without initializer, you can use `remove_class_fields_without_initializer: true` instead.
   */
  allowDeclareFields?: boolean;
  /**
   * When enabled, class fields without initializers are removed.
   *
   * For example:
   * ```ts
   * class Foo {
   *    x: number;
   *    y: number = 0;
   * }
   * ```
   * // transform into
   * ```js
   * class Foo {
   *    x: number;
   * }
   * ```
   *
   * The option is used to align with the behavior of TypeScript's `useDefineForClassFields: false` option.
   * When you want to enable this, you also need to set [`crate::CompilerAssumptions::set_public_class_fields`]
   * to `true`. The `set_public_class_fields: true` + `remove_class_fields_without_initializer: true` is
   * equivalent to `useDefineForClassFields: false` in TypeScript.
   *
   * When `set_public_class_fields` is true and class-properties plugin is enabled, the above example transforms into:
   *
   * ```js
   * class Foo {
   *   constructor() {
   *     this.y = 0;
   *   }
   * }
   * ```
   *
   * Defaults to `false`.
   */
  removeClassFieldsWithoutInitializer?: boolean;
  /**
   * Also generate a `.d.ts` declaration file for TypeScript files.
   *
   * The source file must be compliant with all
   * [`isolatedDeclarations`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html#isolated-declarations)
   * requirements.
   *
   * @default false
   */
  declaration?: IsolatedDeclarationsOptions$1;
  /**
   * Rewrite or remove TypeScript import/export declaration extensions.
   *
   * - When set to `rewrite`, it will change `.ts`, `.mts`, `.cts` extensions to `.js`, `.mjs`, `.cjs` respectively.
   * - When set to `remove`, it will remove `.ts`/`.mts`/`.cts`/`.tsx` extension entirely.
   * - When set to `true`, it's equivalent to `rewrite`.
   * - When set to `false` or omitted, no changes will be made to the extensions.
   *
   * @default false
   */
  rewriteImportExtensions?: 'rewrite' | 'remove' | boolean;
}
/** A decoded source map with mappings as an array of arrays instead of VLQ-encoded string. */
declare class BindingDecodedMap {
  /** The source map version (always 3). */
  get version(): number;
  /** The generated file name. */
  get file(): string | null;
  /** The list of original source files. */
  get sources(): Array<string>;
  /** The original source contents (if `includeContent` was true). */
  get sourcesContent(): Array<string | undefined | null>;
  /** The list of symbol names used in mappings. */
  get names(): Array<string>;
  /**
   * The decoded mappings as an array of line arrays.
   * Each line is an array of segments, where each segment is [generatedColumn, sourceIndex, originalLine, originalColumn, nameIndex?].
   */
  get mappings(): Array<Array<Array<number>>>;
}
declare class BindingMagicString {
  constructor(source: string, options?: BindingMagicStringOptions | undefined | null);
  get filename(): string | null;
  replace(from: string, to: string): this;
  replaceAll(from: string, to: string): this;
  prepend(content: string): this;
  append(content: string): this;
  prependLeft(index: number, content: string): this;
  prependRight(index: number, content: string): this;
  appendLeft(index: number, content: string): this;
  appendRight(index: number, content: string): this;
  overwrite(start: number, end: number, content: string): this;
  toString(): string;
  hasChanged(): boolean;
  length(): number;
  isEmpty(): boolean;
  remove(start: number, end: number): this;
  update(start: number, end: number, content: string): this;
  relocate(start: number, end: number, to: number): this;
  /**
   * Alias for `relocate` to match the original magic-string API.
   * Moves the characters from `start` to `end` to `index`.
   * Returns `this` for method chaining.
   */
  move(start: number, end: number, index: number): this;
  indent(indentor?: string | undefined | null): this;
  /** Trims whitespace or specified characters from the start and end. */
  trim(charType?: string | undefined | null): this;
  /** Trims whitespace or specified characters from the start. */
  trimStart(charType?: string | undefined | null): this;
  /** Trims whitespace or specified characters from the end. */
  trimEnd(charType?: string | undefined | null): this;
  /** Trims newlines from the start and end. */
  trimLines(): this;
  /**
   * Deprecated method that throws an error directing users to use prependRight or appendLeft.
   * This matches the original magic-string API which deprecated this method.
   */
  insert(index: number, content: string): void;
  /** Returns a clone of the MagicString instance. */
  clone(): BindingMagicString;
  /** Returns the last character of the generated string, or an empty string if empty. */
  lastChar(): string;
  /** Returns the content after the last newline in the generated string. */
  lastLine(): string;
  /** Returns a clone with content outside the specified range removed. */
  snip(start: number, end: number): BindingMagicString;
  /**
   * Resets the portion of the string from `start` to `end` to its original content.
   * This undoes any modifications made to that range.
   * Supports negative indices (counting from the end).
   */
  reset(start: number, end: number): this;
  /**
   * Returns the content between the specified original character positions.
   * Supports negative indices (counting from the end).
   */
  slice(start?: number | undefined | null, end?: number | undefined | null): string;
  /**
   * Generates a source map for the transformations applied to this MagicString.
   * Returns a BindingSourceMap object with version, file, sources, sourcesContent, names, mappings.
   */
  generateMap(options?: BindingSourceMapOptions | undefined | null): BindingSourceMap;
  /**
   * Generates a decoded source map for the transformations applied to this MagicString.
   * Returns a BindingDecodedMap object with mappings as an array of arrays.
   */
  generateDecodedMap(options?: BindingSourceMapOptions | undefined | null): BindingDecodedMap;
}
declare class BindingRenderedChunk {
  get name(): string;
  get isEntry(): boolean;
  get isDynamicEntry(): boolean;
  get facadeModuleId(): string | null;
  get moduleIds(): Array<string>;
  get exports(): Array<string>;
  get fileName(): string;
  get modules(): BindingModules;
  get imports(): Array<string>;
  get dynamicImports(): Array<string>;
}
declare class BindingRenderedModule {
  get code(): string | null;
  get renderedExports(): Array<string>;
}
/** A source map object with properties matching the SourceMap V3 specification. */
declare class BindingSourceMap {
  /** The source map version (always 3). */
  get version(): number;
  /** The generated file name. */
  get file(): string | null;
  /** The list of original source files. */
  get sources(): Array<string>;
  /** The original source contents (if `includeContent` was true). */
  get sourcesContent(): Array<string | undefined | null>;
  /** The list of symbol names used in mappings. */
  get names(): Array<string>;
  /** The VLQ-encoded mappings string. */
  get mappings(): string;
  /** Returns the source map as a JSON string. */
  toString(): string;
  /** Returns the source map as a base64-encoded data URL. */
  toUrl(): string;
}
/**
 * Minimal wrapper around the core `Bundler` for watcher events.
 * This is returned from watcher event data to allow access to the bundler instance.
 */
type BindingBuiltinPluginName = 'builtin:esm-external-require' | 'builtin:isolated-declaration' | 'builtin:replace' | 'builtin:vite-alias' | 'builtin:vite-build-import-analysis' | 'builtin:vite-dynamic-import-vars' | 'builtin:vite-import-glob' | 'builtin:vite-json' | 'builtin:vite-load-fallback' | 'builtin:vite-manifest' | 'builtin:vite-module-preload-polyfill' | 'builtin:vite-react-refresh-wrapper' | 'builtin:vite-reporter' | 'builtin:vite-resolve' | 'builtin:vite-transform' | 'builtin:vite-wasm-fallback' | 'builtin:vite-wasm-helper' | 'builtin:vite-web-worker-post';
interface BindingHookResolveIdExtraArgs {
  custom?: number;
  isEntry: boolean;
  /**
   * - `import-statement`: `import { foo } from './lib.js';`
   * - `dynamic-import`: `import('./lib.js')`
   * - `require-call`: `require('./lib.js')`
   * - `import-rule`: `@import 'bg-color.css'`
   * - `url-token`: `url('./icon.png')`
   * - `new-url`: `new URL('./worker.js', import.meta.url)`
   * - `hot-accept`: `import.meta.hot.accept('./lib.js', () => {})`
   */
  kind: 'import-statement' | 'dynamic-import' | 'require-call' | 'import-rule' | 'url-token' | 'new-url' | 'hot-accept';
}
interface BindingMagicStringOptions {
  filename?: string;
}
interface BindingModules {
  values: Array<BindingRenderedModule>;
  keys: Array<string>;
}
interface BindingPluginContextResolveOptions {
  /**
   * - `import-statement`: `import { foo } from './lib.js';`
   * - `dynamic-import`: `import('./lib.js')`
   * - `require-call`: `require('./lib.js')`
   * - `import-rule`: `@import 'bg-color.css'`
   * - `url-token`: `url('./icon.png')`
   * - `new-url`: `new URL('./worker.js', import.meta.url)`
   * - `hot-accept`: `import.meta.hot.accept('./lib.js', () => {})`
   */
  importKind?: 'import-statement' | 'dynamic-import' | 'require-call' | 'import-rule' | 'url-token' | 'new-url' | 'hot-accept';
  isEntry?: boolean;
  skipSelf?: boolean;
  custom?: number;
  vitePluginCustom?: BindingVitePluginCustom;
}
interface BindingSourceMapOptions {
  /** The filename for the generated file (goes into `map.file`) */
  file?: string;
  /** The filename of the original source (goes into `map.sources`) */
  source?: string;
  includeContent?: boolean;
  /**
   * Accepts boolean or string: true, false, "boundary"
   * - true: high-resolution sourcemaps (character-level)
   * - false: low-resolution sourcemaps (line-level) - default
   * - "boundary": high-resolution only at word boundaries
   */
  hires?: boolean | string;
}
interface BindingTransformHookExtraArgs {
  moduleType: string;
}
interface BindingVitePluginCustom {
  'vite:import-glob'?: ViteImportGlobMeta;
}
interface ExternalMemoryStatus {
  freed: boolean;
  reason?: string;
}
interface PreRenderedChunk {
  /** The name of this chunk, which is used in naming patterns. */
  name: string;
  /** Whether this chunk is a static entry point. */
  isEntry: boolean;
  /** Whether this chunk is a dynamic entry point. */
  isDynamicEntry: boolean;
  /** The id of a module that this chunk corresponds to. */
  facadeModuleId?: string;
  /** The list of ids of modules included in this chunk. */
  moduleIds: Array<string>;
  /** Exported variable names from this chunk. */
  exports: Array<string>;
}
interface ViteImportGlobMeta {
  isSubImportsPattern?: boolean;
} //#endregion
//#endregion
//#region ../../node_modules/.pnpm/rolldown@1.0.0-rc.3/node_modules/rolldown/dist/shared/define-config-U4pj0ZDn.d.mts
//#region src/types/misc.d.ts
/** @inline */
type SourcemapPathTransformOption = (relativeSourcePath: string, sourcemapPath: string) => string;
/** @inline */
type SourcemapIgnoreListOption = (relativeSourcePath: string, sourcemapPath: string) => boolean; //#endregion
//#region src/types/module-info.d.ts
/** @category Plugin APIs */
interface ModuleInfo extends ModuleOptions {
  /**
  * @hidden Not supported by Rolldown
  */
  ast: any;
  /**
  * The source code of the module.
  *
  * `null` if external or not yet available.
  */
  code: string | null;
  /**
  * The id of the module for convenience
  */
  id: string;
  /**
  * The ids of all modules that statically import this module.
  */
  importers: string[];
  /**
  * The ids of all modules that dynamically import this module.
  */
  dynamicImporters: string[];
  /**
  * The module ids statically imported by this module.
  */
  importedIds: string[];
  /**
  * The module ids dynamically imported by this module.
  */
  dynamicallyImportedIds: string[];
  /**
  * All exported variables
  */
  exports: string[];
  /**
  * Whether this module is a user- or plugin-defined entry point.
  */
  isEntry: boolean;
} //#endregion
//#region src/utils/asset-source.d.ts
/** @inline */
type AssetSource = string | Uint8Array; //#endregion
//#region src/types/external-memory-handle.d.ts
declare const symbolForExternalMemoryHandle: "__rolldown_external_memory_handle__";
/**
* Interface for objects that hold external memory that can be explicitly freed.
*/
interface ExternalMemoryHandle {
  /**
  * Frees the external memory held by this object.
  * @param keepDataAlive - If true, evaluates all lazy fields before freeing memory.
  *   This will take time but prevents errors when accessing properties after freeing.
  * @returns Status object with `freed` boolean and optional `reason` string.
  * @internal
  */
  [symbolForExternalMemoryHandle]: (keepDataAlive?: boolean) => ExternalMemoryStatus;
}
/**
* Frees the external memory held by the given handle.
*
* This is useful when you want to manually release memory held by Rust objects
* (like `OutputChunk` or `OutputAsset`) before they are garbage collected.
*
* @param handle - The object with external memory to free
* @param keepDataAlive - If true, evaluates all lazy fields before freeing memory (default: false).
*   This will take time to copy data from Rust to JavaScript, but prevents errors
*   when accessing properties after the memory is freed.
* @returns Status object with `freed` boolean and optional `reason` string.
*   - `{ freed: true }` if memory was successfully freed
*   - `{ freed: false, reason: "..." }` if memory couldn't be freed (e.g., already freed or other references exist)
*
* @example
* ```typescript
* import { freeExternalMemory } from 'rolldown/experimental';
*
* const output = await bundle.generate();
* const chunk = output.output[0];
*
* // Use the chunk...
*
* // Manually free the memory (fast, but accessing properties after will throw)
* const status = freeExternalMemory(chunk); // { freed: true }
* const statusAgain = freeExternalMemory(chunk); // { freed: false, reason: "Memory has already been freed" }
*
* // Keep data alive before freeing (slower, but data remains accessible)
* freeExternalMemory(chunk, true); // Evaluates all lazy fields first
* console.log(chunk.code); // OK - data was copied to JavaScript before freeing
*
* // Without keepDataAlive, accessing chunk properties after freeing will throw an error
* ```
*/
//#endregion
//#region src/types/rolldown-output.d.ts
/**
* The information about an asset in the generated bundle.
*
* @category Plugin APIs
*/
interface OutputAsset extends ExternalMemoryHandle {
  type: "asset";
  /** The file name of this asset. */
  fileName: string;
  /** @deprecated Use {@linkcode originalFileNames} instead. */
  originalFileName: string | null;
  /** The list of the absolute paths to the original file of this asset. */
  originalFileNames: string[];
  /** The content of this asset. */
  source: AssetSource;
  /** @deprecated Use {@linkcode names} instead. */
  name: string | undefined;
  names: string[];
}
/** @category Plugin APIs */
interface SourceMap$1 {
  file: string;
  mappings: string;
  names: string[];
  sources: string[];
  sourcesContent: string[];
  version: number;
  debugId?: string;
  x_google_ignoreList?: number[];
  toString(): string;
  toUrl(): string;
}
/** @category Plugin APIs */
interface RenderedModule {
  readonly code: string | null;
  renderedLength: number;
  renderedExports: string[];
}
/**
* The information about the chunk being rendered.
*
* Unlike {@link OutputChunk}, `code` and `map` are not set as the chunk has not been rendered yet.
* All referenced chunk file names in each property that would contain hashes will contain hash placeholders instead.
*
* @category Plugin APIs
*/
interface RenderedChunk extends Omit<BindingRenderedChunk, "modules"> {
  type: "chunk";
  /** Information about the modules included in this chunk. */
  modules: {
    [id: string]: RenderedModule;
  };
  /** The name of this chunk, which is used in naming patterns. */
  name: string;
  /** Whether this chunk is a static entry point. */
  isEntry: boolean;
  /** Whether this chunk is a dynamic entry point. */
  isDynamicEntry: boolean;
  /** The id of a module that this chunk corresponds to. */
  facadeModuleId: string | null;
  /** The list of ids of modules included in this chunk. */
  moduleIds: Array<string>;
  /** Exported variable names from this chunk. */
  exports: Array<string>;
  /** The preliminary file name of this chunk with hash placeholders. */
  fileName: string;
  /** External modules imported statically by this chunk. */
  imports: Array<string>;
  /** External modules imported dynamically by this chunk. */
  dynamicImports: Array<string>;
}
/**
* The information about a chunk in the generated bundle.
*
* @category Plugin APIs
*/
interface OutputChunk extends ExternalMemoryHandle {
  type: "chunk";
  /** The generated code of this chunk. */
  code: string;
  /** The name of this chunk, which is used in naming patterns. */
  name: string;
  /** Whether this chunk is a static entry point. */
  isEntry: boolean;
  /** Exported variable names from this chunk. */
  exports: string[];
  /** The file name of this chunk. */
  fileName: string;
  /** Information about the modules included in this chunk. */
  modules: {
    [id: string]: RenderedModule;
  };
  /** External modules imported statically by this chunk. */
  imports: string[];
  /** External modules imported dynamically by this chunk. */
  dynamicImports: string[];
  /** The id of a module that this chunk corresponds to. */
  facadeModuleId: string | null;
  /** Whether this chunk is a dynamic entry point. */
  isDynamicEntry: boolean;
  moduleIds: string[];
  /** The source map of this chunk if present. */
  map: SourceMap$1 | null;
  sourcemapFileName: string | null;
  /** The preliminary file name of this chunk with hash placeholders. */
  preliminaryFileName: string;
}
/**
* The generated bundle output.
*
* @category Programmatic APIs
*/
//#endregion
//#region src/types/utils.d.ts
type MaybePromise$1<T> = T | Promise<T>;
/** @inline */
type NullValue<T = void> = T | undefined | null | void;
type PartialNull<T> = { [P in keyof T]: T[P] | null };
type MakeAsync<Function_> = Function_ extends ((this: infer This, ...parameters: infer Arguments) => infer Return) ? (this: This, ...parameters: Arguments) => Return | Promise<Return> : never;
type MaybeArray$2<T> = T | T[];
/** @inline */
type StringOrRegExp = string | RegExp; //#endregion
//#region src/options/output-options.d.ts
type GeneratedCodePreset = "es5" | "es2015";
interface GeneratedCodeOptions {
  /**
  * Whether to use Symbol.toStringTag for namespace objects.
  * @default false
  */
  symbols?: boolean;
  /**
  * Allows choosing one of the presets listed above while overriding some options.
  *
  * ```js
  * export default {
  *   output: {
  *     generatedCode: {
  *       preset: 'es2015',
  *       symbols: false
  *     }
  *   }
  * };
  * ```
  *
  * @default 'es2015'
  */
  preset?: GeneratedCodePreset;
  /**
  * Whether to add readable names to internal variables for profiling purposes.
  *
  * When enabled, generated code will use descriptive variable names that correspond
  * to the original module names, making it easier to profile and debug the bundled code.
  *
  * @default false
  *
  *
  */
  profilerNames?: boolean;
}
/** @inline */
type ModuleFormat = "es" | "cjs" | "esm" | "module" | "commonjs" | "iife" | "umd";
/** @inline */
type AddonFunction = (chunk: RenderedChunk) => string | Promise<string>;
/** @inline */
type ChunkFileNamesFunction = (chunkInfo: PreRenderedChunk) => string;
/** @inline */
type SanitizeFileNameFunction = (name: string) => string;
/** @category Plugin APIs */
interface PreRenderedAsset {
  type: "asset";
  /** @deprecated Use {@linkcode names} instead. */
  name?: string;
  names: string[];
  /** @deprecated Use {@linkcode originalFileNames} instead. */
  originalFileName?: string;
  /** The list of the absolute paths to the original file of this asset. */
  originalFileNames: string[];
  /** The content of this asset. */
  source: AssetSource;
}
/** @inline */
type AssetFileNamesFunction = (chunkInfo: PreRenderedAsset) => string;
/** @inline */
type PathsFunction$1 = (id: string) => string;
/** @inline */
type ManualChunksFunction = (moduleId: string, meta: {
  getModuleInfo: (moduleId: string) => ModuleInfo | null;
}) => string | NullValue;
/** @inline */
type GlobalsFunction = (name: string) => string;
/** @category Plugin APIs */
type CodeSplittingNameFunction = (moduleId: string, ctx: ChunkingContext) => string | NullValue;
/** @inline */
type CodeSplittingTestFunction = (id: string) => boolean | undefined | void;
type MinifyOptions$1 = Omit<MinifyOptions$2, "module" | "sourcemap">;
/** @inline */
interface ChunkingContext {
  getModuleInfo(moduleId: string): ModuleInfo | null;
}
interface OutputOptions {
  /**
  * The directory in which all generated chunks are placed.
  *
  * The {@linkcode file | output.file} option can be used instead if only a single chunk is generated.
  *
  *
  *
  * @default 'dist'
  */
  dir?: string;
  /**
  * The file path for the single generated chunk.
  *
  * The {@linkcode dir | output.dir} option should be used instead if multiple chunks are generated.
  */
  file?: string;
  /**
  * Which exports mode to use.
  *
  *
  *
  * @default 'auto'
  */
  exports?: "auto" | "named" | "default" | "none";
  /**
  * Specify the character set that Rolldown is allowed to use in file hashes.
  *
  * - `'base64'`: Uses url-safe base64 characters (0-9, a-z, A-Z, -, _). This will produce the shortest hashes.
  * - `'base36'`: Uses alphanumeric characters (0-9, a-z)
  * - `'hex'`: Uses hexadecimal characters (0-9, a-f)
  *
  * @default 'base64'
  */
  hashCharacters?: "base64" | "base36" | "hex";
  /**
  * Expected format of generated code.
  *
  * - `'es'`, `'esm'` and `'module'` are the same format, all stand for ES module.
  * - `'cjs'` and `'commonjs'` are the same format, all stand for CommonJS module.
  * - `'iife'` stands for [Immediately Invoked Function Expression](https://developer.mozilla.org/en-US/docs/Glossary/IIFE).
  * - `'umd'` stands for [Universal Module Definition](https://github.com/umdjs/umd).
  *
  * @default 'esm'
  *
  *
  */
  format?: ModuleFormat;
  /**
  * Whether to generate sourcemaps.
  *
  * - `false`: No sourcemap will be generated.
  * - `true`: A separate sourcemap file will be generated.
  * - `'inline'`: The sourcemap will be appended to the output file as a data URL.
  * - `'hidden'`: A separate sourcemap file will be generated, but the link to the sourcemap (`//# sourceMappingURL` comment) will not be included in the output file.
  *
  * @default false
  */
  sourcemap?: boolean | "inline" | "hidden";
  /**
  * The base URL for the links to the sourcemap file in the output file.
  *
  * By default, relative URLs are generated. If this option is set, an absolute URL with that base URL will be generated. This is useful when deploying source maps to a different location than your code, such as a CDN or separate debugging server.
  */
  sourcemapBaseUrl?: string;
  /**
  * Whether to include [debug IDs](https://github.com/tc39/ecma426/blob/main/proposals/debug-id.md) in the sourcemap.
  *
  * When `true`, a unique debug ID will be emitted in source and sourcemaps which streamlines identifying sourcemaps across different builds.
  *
  * @default false
  */
  sourcemapDebugIds?: boolean;
  /**
  * Control which source files are included in the sourcemap ignore list.
  *
  * Files in the ignore list are excluded from debugger stepping and error stack traces.
  *
  * - `false`: Include no source files in the ignore list
  * - `true`: Include all source files in the ignore list
  * - `string`: Files containing this string in their path will be included in the ignore list
  * - `RegExp`: Files matching this regular expression will be included in the ignore list
  * - `function`: Custom function to determine if a source should be ignored
  *
  * :::tip Performance
  * Using static values (`boolean`, `string`, or `RegExp`) is significantly more performant than functions.
  * Calling JavaScript functions from Rust has extremely high overhead, so prefer static patterns when possible.
  * :::
  *
  * @example
  * ```js
  * // ✅ Preferred: Use RegExp for better performance
  * sourcemapIgnoreList: /node_modules/
  *
  * // ✅ Preferred: Use string pattern for better performance
  * sourcemapIgnoreList: "vendor"
  *
  * // ! Use sparingly: Function calls have high overhead
  * sourcemapIgnoreList: (source, sourcemapPath) => {
  *   return source.includes('node_modules') || source.includes('.min.');
  * }
  * ```
  *
  * @default /node_modules/
  */
  sourcemapIgnoreList?: boolean | SourcemapIgnoreListOption | StringOrRegExp;
  /**
  * A transformation to apply to each path in a sourcemap.
  *
  * @example
  * ```js
  * export default defineConfig({
  *   output: {
  *     sourcemap: true,
  *     sourcemapPathTransform: (source, sourcemapPath) => {
  *       // Remove 'src/' prefix from all source paths
  *       return source.replace(/^src\//, '');
  *     },
  *   },
  * });
  * ```
  */
  sourcemapPathTransform?: SourcemapPathTransformOption;
  /**
  * A string to prepend to the bundle before {@linkcode Plugin.renderChunk | renderChunk} hook.
  *
  * See {@linkcode intro | output.intro}, {@linkcode postBanner | output.postBanner} as well.
  *
  *
  */
  banner?: string | AddonFunction;
  /**
  * A string to append to the bundle before {@linkcode Plugin.renderChunk | renderChunk} hook.
  *
  * See {@linkcode outro | output.outro}, {@linkcode postFooter | output.postFooter} as well.
  *
  *
  */
  footer?: string | AddonFunction;
  /**
  * A string to prepend to the bundle after {@linkcode Plugin.renderChunk | renderChunk} hook and minification.
  *
  * See {@linkcode banner | output.banner}, {@linkcode intro | output.intro} as well.
  *
  *
  */
  postBanner?: string | AddonFunction;
  /**
  * A string to append to the bundle after {@linkcode Plugin.renderChunk | renderChunk} hook and minification.
  *
  * See {@linkcode footer | output.footer}, {@linkcode outro | output.outro} as well.
  *
  *
  */
  postFooter?: string | AddonFunction;
  /**
  * A string to prepend inside any {@link OutputOptions.format | format}-specific wrapper.
  *
  * See {@linkcode banner | output.banner}, {@linkcode postBanner | output.postBanner} as well.
  *
  *
  */
  intro?: string | AddonFunction;
  /**
  * A string to append inside any {@link OutputOptions.format | format}-specific wrapper.
  *
  * See {@linkcode footer | output.footer}, {@linkcode postFooter | output.postFooter} as well.
  *
  *
  */
  outro?: string | AddonFunction;
  /**
  * Whether to extend the global variable defined by the {@linkcode OutputOptions.name | name} option in `umd` or `iife` {@link OutputOptions.format | formats}.
  *
  * When `true`, the global variable will be defined as `global.name = global.name || {}`.
  * When `false`, the global defined by name will be overwritten like `global.name = {}`.
  *
  * @default false
  */
  extend?: boolean;
  /**
  * Whether to add a `__esModule: true` property when generating exports for non-ES {@link OutputOptions.format | formats}.
  *
  * This property signifies that the exported value is the namespace of an ES module and that the default export of this module corresponds to the `.default` property of the exported object.
  *
  * - `true`: Always add the property when using {@link OutputOptions.exports | named exports mode}, which is similar to what other tools do.
  * - `"if-default-prop"`: Only add the property when using {@link OutputOptions.exports | named exports mode} and there also is a default export. The subtle difference is that if there is no default export, consumers of the CommonJS version of your library will get all named exports as default export instead of an error or `undefined`.
  * - `false`: Never add the property even if the default export would become a property `.default`.
  *
  * @default 'if-default-prop'
  *
  *
  */
  esModule?: boolean | "if-default-prop";
  /**
  * The pattern to use for naming custom emitted assets to include in the build output, or a function that is called per asset with {@linkcode PreRenderedAsset} to return such a pattern.
  *
  * Patterns support the following placeholders:
  * - `[extname]`: The file extension of the asset including a leading dot, e.g. `.css`.
  * - `[ext]`: The file extension without a leading dot, e.g. css.
  * - `[hash]`: A hash based on the content of the asset. You can also set a specific hash length via e.g. `[hash:10]`. By default, it will create a base-64 hash. If you need a reduced character set, see {@linkcode hashCharacters | output.hashCharacters}.
  * - `[name]`: The file name of the asset excluding any extension.
  *
  * Forward slashes (`/`) can be used to place files in sub-directories.
  *
  * See also {@linkcode chunkFileNames | output.chunkFileNames}, {@linkcode entryFileNames | output.entryFileNames}.
  *
  * @default 'assets/[name]-[hash][extname]'
  */
  assetFileNames?: string | AssetFileNamesFunction;
  /**
  * The pattern to use for chunks created from entry points, or a function that is called per entry chunk with {@linkcode PreRenderedChunk} to return such a pattern.
  *
  * Patterns support the following placeholders:
  * - `[format]`: The rendering format defined in the output options. The value is any of {@linkcode InternalModuleFormat}.
  * - `[hash]`: A hash based only on the content of the final generated chunk, including transformations in `renderChunk` and any referenced file hashes. You can also set a specific hash length via e.g. `[hash:10]`. By default, it will create a base-64 hash. If you need a reduced character set, see {@linkcode hashCharacters | output.hashCharacters}.
  * - `[name]`: The file name (without extension) of the entry point, unless the object form of input was used to define a different name.
  *
  * Forward slashes (`/`) can be used to place files in sub-directories. This pattern will also be used for every file when setting the {@linkcode preserveModules | output.preserveModules} option.
  *
  * See also {@linkcode assetFileNames | output.assetFileNames}, {@linkcode chunkFileNames | output.chunkFileNames}.
  *
  * @default '[name].js'
  */
  entryFileNames?: string | ChunkFileNamesFunction;
  /**
  * The pattern to use for naming shared chunks created when code-splitting, or a function that is called per chunk with {@linkcode PreRenderedChunk} to return such a pattern.
  *
  * Patterns support the following placeholders:
  * - `[format]`: The rendering format defined in the output options. The value is any of {@linkcode InternalModuleFormat}.
  * - `[hash]`: A hash based only on the content of the final generated chunk, including transformations in `renderChunk` and any referenced file hashes. You can also set a specific hash length via e.g. `[hash:10]`. By default, it will create a base-64 hash. If you need a reduced character set, see {@linkcode hashCharacters | output.hashCharacters}.
  * - `[name]`: The name of the chunk. This can be explicitly set via the {@linkcode codeSplitting | output.codeSplitting} option or when the chunk is created by a plugin via `this.emitFile`. Otherwise, it will be derived from the chunk contents.
  *
  * Forward slashes (`/`) can be used to place files in sub-directories.
  *
  * See also {@linkcode assetFileNames | output.assetFileNames}, {@linkcode entryFileNames | output.entryFileNames}.
  *
  * @default '[name]-[hash].js'
  */
  chunkFileNames?: string | ChunkFileNamesFunction;
  /**
  * @default '[name].css'
  * @experimental
  * @hidden not ready for public usage yet
  */
  cssEntryFileNames?: string | ChunkFileNamesFunction;
  /**
  * @default '[name]-[hash].css'
  * @experimental
  * @hidden not ready for public usage yet
  */
  cssChunkFileNames?: string | ChunkFileNamesFunction;
  /**
  * Whether to enable chunk name sanitization (removal of non-URL-safe characters like `\0`, `?` and `*`).
  *
  * Set `false` to disable the sanitization. You can also provide a custom sanitization function.
  *
  * @default true
  */
  sanitizeFileName?: boolean | SanitizeFileNameFunction;
  /**
  * Control code minification
  *
  * Rolldown uses Oxc Minifier under the hood. See Oxc's [minification documentation](https://oxc.rs/docs/guide/usage/minifier#features) for more details.
  *
  * - `true`: Enable full minification including code compression and dead code elimination
  * - `false`: Disable minification (default)
  * - `'dce-only'`: Only perform dead code elimination without code compression
  * - `MinifyOptions`: Fine-grained control over minification settings
  *
  * @default false
  */
  minify?: boolean | "dce-only" | MinifyOptions$1;
  /**
  * Specifies the global variable name that contains the exports of `umd` / `iife` {@link OutputOptions.format | formats}.
  *
  * @example
  * ```js
  * export default defineConfig({
  *   output: {
  *     format: 'iife',
  *     name: 'MyBundle',
  *   }
  * });
  * ```
  * ```js
  * // output
  * var MyBundle = (function () {
  *   // ...
  * })();
  * ```
  *
  *
  */
  name?: string;
  /**
  * Specifies `id: variableName` pairs necessary for {@link InputOptions.external | external} imports in `umd` / `iife` {@link OutputOptions.format | formats}.
  *
  * @example
  * ```js
  * export default defineConfig({
  *   external: ['jquery'],
  *   output: {
  *     format: 'iife',
  *     name: 'MyBundle',
  *     globals: {
  *       jquery: '$',
  *     }
  *   }
  * });
  * ```
  * ```js
  * // input
  * import $ from 'jquery';
  * ```
  * ```js
  * // output
  * var MyBundle = (function ($) {
  *   // ...
  * })($);
  * ```
  */
  globals?: Record<string, string> | GlobalsFunction;
  /**
  * Maps {@link InputOptions.external | external} module IDs to paths.
  *
  * Allows customizing the path used when importing external dependencies.
  * This is particularly useful for loading dependencies from CDNs or custom locations.
  *
  * - Object form: Maps module IDs to their replacement paths
  * - Function form: Takes a module ID and returns its replacement path
  *
  * @example
  * ```js
  * {
  *   paths: {
  *     'd3': 'https://cdn.jsdelivr.net/npm/d3@7'
  *   }
  * }
  * ```
  *
  * @example
  * ```js
  * {
  *   paths: (id) => {
  *     if (id.startsWith('lodash')) {
  *       return `https://cdn.jsdelivr.net/npm/${id}`
  *     }
  *     return id
  *   }
  * }
  * ```
  */
  paths?: Record<string, string> | PathsFunction$1;
  /**
  * Which language features Rolldown can safely use in generated code.
  *
  * This will not transpile any user code but only change the code Rolldown uses in wrappers and helpers.
  */
  generatedCode?: Partial<GeneratedCodeOptions>;
  /**
  * Whether to generate code to support live bindings for {@link InputOptions.external | external} imports.
  *
  * With the default value of `true`, Rolldown will generate code to support live bindings for external imports.
  *
  * When set to `false`, Rolldown will assume that exports from external modules do not change. This will allow Rolldown to generate smaller code. Note that this can cause issues when there are circular dependencies involving an external dependency.
  *
  * @default true
  *
  *
  */
  externalLiveBindings?: boolean;
  /**
  * @deprecated Please use `codeSplitting: false` instead.
  *
  * Whether to inline dynamic imports instead of creating new chunks to create a single bundle.
  *
  * This option can be used only when a single input is provided.
  *
  * @default false
  */
  inlineDynamicImports?: boolean;
  /**
  * Whether to keep external dynamic imports as `import(...)` expressions in CommonJS output.
  *
  * If set to `false`, external dynamic imports will be rewritten to use `require(...)` calls.
  * This may be necessary to support environments that do not support dynamic `import()` in CommonJS modules like old Node.js versions.
  *
  * @default true
  */
  dynamicImportInCjs?: boolean;
  /**
  * Allows you to do manual chunking. Provided for Rollup compatibility.
  *
  * You could use this option for migration purpose. Under the hood,
  *
  * ```js
  * {
  *   manualChunks: (moduleId, meta) => {
  *     if (moduleId.includes('node_modules')) {
  *       return 'vendor';
  *     }
  *     return null;
  *   }
  * }
  * ```
  *
  * will be transformed to
  *
  * ```js
  * {
  *   codeSplitting: {
  *     groups: [
  *       {
  *         name(moduleId) {
  *           if (moduleId.includes('node_modules')) {
  *             return 'vendor';
  *           }
  *           return null;
  *         },
  *       },
  *     ],
  *   }
  * }
  *
  * ```
  *
  * Note that unlike Rollup, object form is not supported.
  *
  * @deprecated
  * Please use {@linkcode codeSplitting | output.codeSplitting} instead.
  *
  * :::warning
  * If `manualChunks` and `codeSplitting` are both specified, `manualChunks` option will be ignored.
  * :::
  */
  manualChunks?: ManualChunksFunction;
  /**
  * Controls how code splitting is performed.
  *
  * - `true`: Default behavior, automatic code splitting. **(default)**
  * - `false`: Inline all dynamic imports into a single bundle (equivalent to deprecated `inlineDynamicImports: true`).
  * - `object`: Advanced manual code splitting configuration.
  *
  * For deeper understanding, please refer to the in-depth [documentation](https://rolldown.rs/in-depth/manual-code-splitting).
  *
  * @example
  * **Basic vendor chunk**
  * ```js
  * export default defineConfig({
  *   output: {
  *     codeSplitting: {
  *       minSize: 20000,
  *       groups: [
  *         {
  *           name: 'vendor',
  *           test: /node_modules/,
  *         },
  *       ],
  *     },
  *   },
  * });
  * ```
  *
  *
  * @default true
  */
  codeSplitting?: boolean | CodeSplittingOptions;
  /**
  * @deprecated Please use {@linkcode codeSplitting | output.codeSplitting} instead.
  *
  * Allows you to do manual chunking.
  *
  * :::warning
  * If `advancedChunks` and `codeSplitting` are both specified, `advancedChunks` option will be ignored.
  * :::
  */
  advancedChunks?: {
    includeDependenciesRecursively?: boolean;
    minSize?: number;
    maxSize?: number;
    maxModuleSize?: number;
    minModuleSize?: number;
    minShareCount?: number;
    groups?: CodeSplittingGroup[];
  };
  /**
  * Control comments in the output.
  *
  * - `none`: no comments
  * - `inline`: preserve comments that contain `@license`, `@preserve` or starts with `//!` `/*!`
  */
  legalComments?: "none" | "inline";
  /**
  * The list of plugins to use only for this output.
  *
  * @see {@linkcode InputOptions.plugins | plugins}
  */
  plugins?: RolldownOutputPluginOption;
  /**
  * Whether to add a polyfill for `require()` function in non-CommonJS formats.
  *
  * This option is useful when you want to inject your own `require` implementation.
  *
  * @default true
  */
  polyfillRequire?: boolean;
  /**
  * This option is not implemented yet.
  * @hidden
  */
  hoistTransitiveImports?: false;
  /**
  * Whether to use preserve modules mode.
  *
  *
  *
  * @default false
  */
  preserveModules?: boolean;
  /**
  * Specifies the directory name for "virtual" files that might be emitted by plugins when using {@link OutputOptions.preserveModules | preserve modules mode}.
  *
  * @default '_virtual'
  */
  virtualDirname?: string;
  /**
  * A directory path to input modules that should be stripped away from {@linkcode dir | output.dir} when using {@link OutputOptions.preserveModules | preserve modules mode}.
  *
  *
  */
  preserveModulesRoot?: string;
  /**
  * Whether to use `var` declarations at the top level scope instead of function / class / let / const expressions.
  *
  * Enabling this option can improve runtime performance of the generated code in certain environments.
  *
  * @default false
  *
  *
  */
  topLevelVar?: boolean;
  /**
  * Whether to minify internal exports as single letter variables to allow for better minification.
  *
  * @default
  * `true` for format `es` or if `output.minify` is `true` or object, `false` otherwise
  *
  *
  */
  minifyInternalExports?: boolean;
  /**
  * Clean output directory ({@linkcode dir | output.dir}) before emitting output.
  *
  * @default false
  *
  *
  */
  cleanDir?: boolean;
  /**
  * Keep `name` property of functions and classes after bundling.
  *
  * When enabled, the bundler will preserve the original `name` property value of functions and
  * classes in the output. This is useful for debugging and some frameworks that rely on it for
  * registration and binding purposes.
  *
  *
  *
  * @default false
  */
  keepNames?: boolean;
  /**
  * Lets modules be executed in the order they are declared.
  *
  * This is done by injecting runtime helpers to ensure that modules are executed in the order they are imported. External modules won't be affected.
  *
  * > [!WARNING]
  * > Enabling this option may negatively increase bundle size. It is recommended to use this option only when absolutely necessary.
  * @default false
  */
  strictExecutionOrder?: boolean;
}
type CodeSplittingGroup = {
  /**
  * Name of the group. It will be also used as the name of the chunk and replace the `[name]` placeholder in the {@linkcode OutputOptions.chunkFileNames | output.chunkFileNames} option.
  *
  * For example,
  *
  * ```js
  * import { defineConfig } from 'rolldown';
  *
  * export default defineConfig({
  *   output: {
  *     codeSplitting: {
  *       groups: [
  *         {
  *           name: 'libs',
  *           test: /node_modules/,
  *         },
  *       ],
  *     },
  *   },
  * });
  * ```
  * will create a chunk named `libs-[hash].js` in the end.
  *
  * It's ok to have the same name for different groups. Rolldown will deduplicate the chunk names if necessary.
  *
  * #### Dynamic `name()`
  *
  * If `name` is a function, it will be called with the module id as the argument. The function should return a string or `null`. If it returns `null`, the module will be ignored by this group.
  *
  * Notice, each returned new name will be treated as a separate group.
  *
  * For example,
  *
  * ```js
  * import { defineConfig } from 'rolldown';
  *
  * export default defineConfig({
  *   output: {
  *     codeSplitting: {
  *       groups: [
  *         {
  *           name: (moduleId) => moduleId.includes('node_modules') ? 'libs' : 'app',
  *           minSize: 100 * 1024,
  *         },
  *       ],
  *     },
  *   },
  * });
  * ```
  *
  * :::warning
  * Constraints like `minSize`, `maxSize`, etc. are applied separately for different names returned by the function.
  * :::
  */
  name: string | CodeSplittingNameFunction;
  /**
  * Controls which modules are captured in this group.
  *
  * - If `test` is a string, the module whose id contains the string will be captured.
  * - If `test` is a regular expression, the module whose id matches the regular expression will be captured.
  * - If `test` is a function, modules for which `test(id)` returns `true` will be captured.
  * - If `test` is empty, any module will be considered as matched.
  *
  * :::warning
  * When using regular expression, it's recommended to use `[\\/]` to match the path separator instead of `/` to avoid potential issues on Windows.
  * - ✅ Recommended: `/node_modules[\\/]react/`
  * - ❌ Not recommended: `/node_modules/react/`
  * :::
  */
  test?: StringOrRegExp | CodeSplittingTestFunction;
  /**
  * Priority of the group. Group with higher priority will be chosen first to match modules and create chunks. When converting the group to a chunk, modules of that group will be removed from other groups.
  *
  * If two groups have the same priority, the group whose index is smaller will be chosen.
  *
  * @example
  * ```js
  * import { defineConfig } from 'rolldown';
  *
  * export default defineConfig({
  *   output: {
  *     codeSplitting: {
  *       groups: [
  *         {
  *           name: 'react',
  *           test: /node_modules[\\/]react/,
  *           priority: 2,
  *         },
  *         {
  *           name: 'other-libs',
  *           test: /node_modules/,
  *           priority: 1,
  *         },
  *       ],
  *     },
  *   },
  * });
  * ```
  *
  * @default 0
  */
  priority?: number;
  /**
  * Minimum size in bytes of the desired chunk. If the accumulated size of the captured modules by this group is smaller than this value, it will be ignored. Modules in this group will fall back to the `automatic chunking` if they are not captured by any other group.
  *
  * @default 0
  */
  minSize?: number;
  /**
  * Controls if a module should be captured based on how many entry chunks reference it.
  *
  * @default 1
  */
  minShareCount?: number;
  /**
  * If the accumulated size in bytes of the captured modules by this group is larger than this value, this group will be split into multiple groups that each has size close to this value.
  *
  * @default Infinity
  */
  maxSize?: number;
  /**
  * Controls whether a module can only be captured if its size in bytes is smaller than or equal to this value.
  *
  * @default Infinity
  */
  maxModuleSize?: number;
  /**
  * Controls whether a module can only be captured if its size in bytes is larger than or equal to this value.
  *
  * @default 0
  */
  minModuleSize?: number;
};
/**
* Alias for {@linkcode CodeSplittingGroup}. Use this type for the `codeSplitting.groups` option.
*
* @deprecated Please use {@linkcode CodeSplittingGroup} instead.
*/
/**
* Configuration options for advanced code splitting.
*/
type CodeSplittingOptions = {
  /**
  * By default, each group will also include captured modules' dependencies. This reduces the chance of generating circular chunks.
  *
  * If you want to disable this behavior, it's recommended to both set
  * - {@linkcode InputOptions.preserveEntrySignatures | preserveEntrySignatures}: `false | 'allow-extension'`
  * - {@linkcode OutputOptions.strictExecutionOrder | strictExecutionOrder}: `true`
  *
  * to avoid generating invalid chunks.
  *
  * @default true
  */
  includeDependenciesRecursively?: boolean;
  /**
  * Global fallback of {@linkcode CodeSplittingGroup.minSize | group.minSize}, if it's not specified in the group.
  */
  minSize?: number;
  /**
  * Global fallback of {@linkcode CodeSplittingGroup.maxSize | group.maxSize}, if it's not specified in the group.
  */
  maxSize?: number;
  /**
  * Global fallback of {@linkcode CodeSplittingGroup.maxModuleSize | group.maxModuleSize}, if it's not specified in the group.
  */
  maxModuleSize?: number;
  /**
  * Global fallback of {@linkcode CodeSplittingGroup.minModuleSize | group.minModuleSize}, if it's not specified in the group.
  */
  minModuleSize?: number;
  /**
  * Global fallback of {@linkcode CodeSplittingGroup.minShareCount | group.minShareCount}, if it's not specified in the group.
  */
  minShareCount?: number;
  /**
  * Groups to be used for code splitting.
  */
  groups?: CodeSplittingGroup[];
};
/**
* Alias for {@linkcode CodeSplittingOptions}. Use this type for the `codeSplitting` option.
*
* @deprecated Please use {@linkcode CodeSplittingOptions} instead.
*/
//#endregion
//#region src/log/log-handler.d.ts
type LoggingFunction = (log: RolldownLog | string | (() => RolldownLog | string)) => void;
type LoggingFunctionWithPosition = (log: RolldownLog | string | (() => RolldownLog | string), pos?: number | {
  column: number;
  line: number;
}) => void;
//#endregion
//#region src/options/generated/checks-options.d.ts
interface ChecksOptions {
  /**
  * Whether to emit warnings when detecting circular dependency.
  *
  * Circular dependencies lead to a bigger bundle size and sometimes cause execution order issues and are better to avoid.
  *
  *
  * @default false
  * */
  circularDependency?: boolean;
  /**
  * Whether to emit warnings when detecting uses of direct `eval`s.
  *
  * See [Avoiding Direct `eval` in Troubleshooting page](https://rolldown.rs/guide/troubleshooting#avoiding-direct-eval) for more details.
  * @default true
  * */
  eval?: boolean;
  /**
  * Whether to emit warnings when the `output.globals` option is missing when needed.
  *
  * See [`output.globals`](https://rolldown.rs/reference/OutputOptions.globals).
  * @default true
  * */
  missingGlobalName?: boolean;
  /**
  * Whether to emit warnings when the `output.name` option is missing when needed.
  *
  * See [`output.name`](https://rolldown.rs/reference/OutputOptions.name).
  * @default true
  * */
  missingNameOptionForIifeExport?: boolean;
  /**
  * Whether to emit warnings when the way to export values is ambiguous.
  *
  * See [`output.exports`](https://rolldown.rs/reference/OutputOptions.exports).
  * @default true
  * */
  mixedExports?: boolean;
  /**
  * Whether to emit warnings when an entrypoint cannot be resolved.
  * @default true
  * */
  unresolvedEntry?: boolean;
  /**
  * Whether to emit warnings when an import cannot be resolved.
  * @default true
  * */
  unresolvedImport?: boolean;
  /**
  * Whether to emit warnings when files generated have the same name with different contents.
  *
  *
  * @default true
  * */
  filenameConflict?: boolean;
  /**
  * Whether to emit warnings when a CommonJS variable is used in an ES module.
  *
  * CommonJS variables like `module` and `exports` are treated as global variables in ES modules and may not work as expected.
  *
  *
  * @default true
  * */
  commonJsVariableInEsm?: boolean;
  /**
  * Whether to emit warnings when an imported variable is not exported.
  *
  * If the code is importing a variable that is not exported by the imported module, the value will always be `undefined`. This might be a mistake in the code.
  *
  *
  * @default true
  * */
  importIsUndefined?: boolean;
  /**
  * Whether to emit warnings when `import.meta` is not supported with the output format and is replaced with an empty object (`{}`).
  *
  * See [`import.meta` in Non-ESM Output Formats page](https://rolldown.rs/in-depth/non-esm-output-formats#import-meta) for more details.
  * @default true
  * */
  emptyImportMeta?: boolean;
  /**
  * Whether to emit warnings when detecting tolerated transform.
  * @default true
  * */
  toleratedTransform?: boolean;
  /**
  * Whether to emit warnings when a namespace is called as a function.
  *
  * A module namespace object is an object and not a function. Calling it as a function will cause a runtime error.
  *
  *
  * @default true
  * */
  cannotCallNamespace?: boolean;
  /**
  * Whether to emit warnings when a config value is overridden by another config value with a higher priority.
  *
  *
  * @default true
  * */
  configurationFieldConflict?: boolean;
  /**
  * Whether to emit warnings when a plugin that is covered by a built-in feature is used.
  *
  * Using built-in features is generally more performant than using plugins.
  * @default true
  * */
  preferBuiltinFeature?: boolean;
  /**
  * Whether to emit warnings when Rolldown could not clean the output directory.
  *
  * See [`output.cleanDir`](https://rolldown.rs/reference/OutputOptions.cleanDir).
  * @default true
  * */
  couldNotCleanDirectory?: boolean;
  /**
  * Whether to emit warnings when plugins take significant time during the build process.
  *
  *
  * @default true
  * */
  pluginTimings?: boolean;
  /**
  * Whether to emit warnings when both the code and postBanner contain shebang
  *
  * Having multiple shebangs in a file is a syntax error.
  * @default true
  * */
  duplicateShebang?: boolean;
  /**
  * Whether to emit warnings when a tsconfig option or combination of options is not supported.
  * @default true
  * */
  unsupportedTsconfigOption?: boolean;
} //#endregion
//#region src/options/transform-options.d.ts
interface TransformOptions$1 extends Omit<TransformOptions$2, "sourceType" | "lang" | "cwd" | "sourcemap" | "define" | "inject" | "jsx"> {
  /**
  * Replace global variables or [property accessors](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Property_accessors) with the provided values.
  *
  * See Oxc's [`define` option](https://oxc.rs/docs/guide/usage/transformer/global-variable-replacement.html#define) for more details.
  *
  * @example
  * **Replace the global variable `IS_PROD` with `true`**
  * ```js [rolldown.config.js]
  * export default defineConfig({
  *   transform: { define: { IS_PROD: 'true' } }
  * })
  * ```
  * Result:
  * ```js
  * // Input
  * if (IS_PROD) {
  *   console.log('Production mode')
  * }
  *
  * // After bundling
  * if (true) {
  *   console.log('Production mode')
  * }
  * ```
  *
  * **Replace the property accessor `process.env.NODE_ENV` with `'production'`**
  * ```js [rolldown.config.js]
  * export default defineConfig({
  *   transform: { define: { 'process.env.NODE_ENV': "'production'" } }
  * })
  * ```
  * Result:
  * ```js
  * // Input
  * if (process.env.NODE_ENV === 'production') {
  *   console.log('Production mode')
  * }
  *
  * // After bundling
  * if ('production' === 'production') {
  *   console.log('Production mode')
  * }
  * ```
  */
  define?: Record<string, string>;
  /**
  * Inject import statements on demand.
  *
  * The API is aligned with `@rollup/plugin-inject`.
  *
  * See Oxc's [`inject` option](https://oxc.rs/docs/guide/usage/transformer/global-variable-replacement.html#inject) for more details.
  *
  * #### Supported patterns
  * ```js
  * {
  *   // import { Promise } from 'es6-promise'
  *   Promise: ['es6-promise', 'Promise'],
  *
  *   // import { Promise as P } from 'es6-promise'
  *   P: ['es6-promise', 'Promise'],
  *
  *   // import $ from 'jquery'
  *   $: 'jquery',
  *
  *   // import * as fs from 'node:fs'
  *   fs: ['node:fs', '*'],
  *
  *   // Inject shims for property access pattern
  *   'Object.assign': path.resolve( 'src/helpers/object-assign.js' ),
  * }
  * ```
  */
  inject?: Record<string, string | [string, string]>;
  /**
  * Remove labeled statements with these label names.
  *
  * Labeled statements are JavaScript statements prefixed with a label identifier.
  * This option allows you to strip specific labeled statements from the output,
  * which is useful for removing debug-only code in production builds.
  *
  * @example
  * ```js rolldown.config.js
  * export default defineConfig({
  *   transform: { dropLabels: ['DEBUG', 'DEV'] }
  * })
  * ```
  * Result:
  * ```js
  * // Input
  * DEBUG: console.log('Debug info');
  * DEV: {
  *   console.log('Development mode');
  * }
  * console.log('Production code');
  *
  * // After bundling
  * console.log('Production code');
  * ```
  */
  dropLabels?: string[];
  /**
  * Controls how JSX syntax is transformed.
  *
  * - If set to `false`, an error will be thrown if JSX syntax is encountered.
  * - If set to `'react'`, JSX syntax will be transformed to classic runtime React code.
  * - If set to `'react-jsx'`, JSX syntax will be transformed to automatic runtime React code.
  * - If set to `'preserve'`, JSX syntax will be preserved as-is.
  */
  jsx?: false | "react" | "react-jsx" | "preserve" | JsxOptions$1;
} //#endregion
//#region src/options/normalized-input-options.d.ts
/** @category Plugin APIs */
interface NormalizedInputOptions {
  /** @see {@linkcode InputOptions.input | input} */
  input: string[] | Record<string, string>;
  /** @see {@linkcode InputOptions.cwd | cwd} */
  cwd: string;
  /** @see {@linkcode InputOptions.platform | platform} */
  platform: InputOptions["platform"];
  /** @see {@linkcode InputOptions.shimMissingExports | shimMissingExports} */
  shimMissingExports: boolean;
  /** @see {@linkcode InputOptions.context | context} */
  context: string;
} //#endregion
//#region src/options/normalized-output-options.d.ts
type PathsFunction = (id: string) => string;
/**
* A normalized version of {@linkcode ModuleFormat}.
* @category Plugin APIs
*/
type InternalModuleFormat = "es" | "cjs" | "iife" | "umd";
/** @category Plugin APIs */
interface NormalizedOutputOptions {
  /** @see {@linkcode OutputOptions.name | name} */
  name: string | undefined;
  /** @see {@linkcode OutputOptions.file | file} */
  file: string | undefined;
  /** @see {@linkcode OutputOptions.dir | dir} */
  dir: string | undefined;
  /** @see {@linkcode OutputOptions.entryFileNames | entryFileNames} */
  entryFileNames: string | ChunkFileNamesFunction;
  /** @see {@linkcode OutputOptions.chunkFileNames | chunkFileNames} */
  chunkFileNames: string | ChunkFileNamesFunction;
  /** @see {@linkcode OutputOptions.assetFileNames | assetFileNames} */
  assetFileNames: string | AssetFileNamesFunction;
  /** @see {@linkcode OutputOptions.format | format} */
  format: InternalModuleFormat;
  /** @see {@linkcode OutputOptions.exports | exports} */
  exports: NonNullable<OutputOptions["exports"]>;
  /** @see {@linkcode OutputOptions.sourcemap | sourcemap} */
  sourcemap: boolean | "inline" | "hidden";
  /** @see {@linkcode OutputOptions.sourcemapBaseUrl | sourcemapBaseUrl} */
  sourcemapBaseUrl: string | undefined;
  /** @see {@linkcode OutputOptions.cssEntryFileNames | cssEntryFileNames} */
  cssEntryFileNames: string | ChunkFileNamesFunction;
  /** @see {@linkcode OutputOptions.cssChunkFileNames | cssChunkFileNames} */
  cssChunkFileNames: string | ChunkFileNamesFunction;
  /** @see {@linkcode OutputOptions.codeSplitting | codeSplitting} */
  codeSplitting: boolean;
  /** @deprecated Use `codeSplitting` instead. */
  inlineDynamicImports: boolean;
  /** @see {@linkcode OutputOptions.dynamicImportInCjs | dynamicImportInCjs} */
  dynamicImportInCjs: boolean;
  /** @see {@linkcode OutputOptions.externalLiveBindings | externalLiveBindings} */
  externalLiveBindings: boolean;
  /** @see {@linkcode OutputOptions.banner | banner} */
  banner: AddonFunction;
  /** @see {@linkcode OutputOptions.footer | footer} */
  footer: AddonFunction;
  /** @see {@linkcode OutputOptions.postBanner | postBanner} */
  postBanner: AddonFunction;
  /** @see {@linkcode OutputOptions.postFooter | postFooter} */
  postFooter: AddonFunction;
  /** @see {@linkcode OutputOptions.intro | intro} */
  intro: AddonFunction;
  /** @see {@linkcode OutputOptions.outro | outro} */
  outro: AddonFunction;
  /** @see {@linkcode OutputOptions.esModule | esModule} */
  esModule: boolean | "if-default-prop";
  /** @see {@linkcode OutputOptions.extend | extend} */
  extend: boolean;
  /** @see {@linkcode OutputOptions.globals | globals} */
  globals: Record<string, string> | GlobalsFunction;
  /** @see {@linkcode OutputOptions.paths | paths} */
  paths: Record<string, string> | PathsFunction | undefined;
  /** @see {@linkcode OutputOptions.hashCharacters | hashCharacters} */
  hashCharacters: "base64" | "base36" | "hex";
  /** @see {@linkcode OutputOptions.sourcemapDebugIds | sourcemapDebugIds} */
  sourcemapDebugIds: boolean;
  /** @see {@linkcode OutputOptions.sourcemapIgnoreList | sourcemapIgnoreList} */
  sourcemapIgnoreList: boolean | SourcemapIgnoreListOption | StringOrRegExp | undefined;
  /** @see {@linkcode OutputOptions.sourcemapPathTransform | sourcemapPathTransform} */
  sourcemapPathTransform: SourcemapPathTransformOption | undefined;
  /** @see {@linkcode OutputOptions.minify | minify} */
  minify: false | MinifyOptions$1 | "dce-only";
  /** @see {@linkcode OutputOptions.legalComments | legalComments} */
  legalComments: "none" | "inline";
  /** @see {@linkcode OutputOptions.polyfillRequire | polyfillRequire} */
  polyfillRequire: boolean;
  /** @see {@linkcode OutputOptions.plugins | plugins} */
  plugins: RolldownPlugin[];
  /** @see {@linkcode OutputOptions.preserveModules | preserveModules} */
  preserveModules: boolean;
  /** @see {@linkcode OutputOptions.virtualDirname | virtualDirname} */
  virtualDirname: string;
  /** @see {@linkcode OutputOptions.preserveModulesRoot | preserveModulesRoot} */
  preserveModulesRoot?: string;
  /** @see {@linkcode OutputOptions.topLevelVar | topLevelVar} */
  topLevelVar?: boolean;
  /** @see {@linkcode OutputOptions.minifyInternalExports | minifyInternalExports} */
  minifyInternalExports?: boolean;
} //#endregion
//#region src/plugin/fs.d.ts
/** @category Plugin APIs */
interface RolldownFsModule {
  appendFile(path: string, data: string | Uint8Array, options?: {
    encoding?: BufferEncoding | null;
    mode?: string | number;
    flag?: string | number;
  }): Promise<void>;
  copyFile(source: string, destination: string, mode?: string | number): Promise<void>;
  mkdir(path: string, options?: {
    recursive?: boolean;
    mode?: string | number;
  }): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  readdir(path: string, options?: {
    withFileTypes?: false;
  }): Promise<string[]>;
  readdir(path: string, options?: {
    withFileTypes: true;
  }): Promise<RolldownDirectoryEntry[]>;
  readFile(path: string, options?: {
    encoding?: null;
    flag?: string | number;
    signal?: AbortSignal;
  }): Promise<Uint8Array>;
  readFile(path: string, options?: {
    encoding: BufferEncoding;
    flag?: string | number;
    signal?: AbortSignal;
  }): Promise<string>;
  realpath(path: string): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rmdir(path: string, options?: {
    recursive?: boolean;
  }): Promise<void>;
  stat(path: string): Promise<RolldownFileStats>;
  lstat(path: string): Promise<RolldownFileStats>;
  unlink(path: string): Promise<void>;
  writeFile(path: string, data: string | Uint8Array, options?: {
    encoding?: BufferEncoding | null;
    mode?: string | number;
    flag?: string | number;
  }): Promise<void>;
}
/** @category Plugin APIs */
type BufferEncoding = "ascii" | "utf8" | "utf16le" | "ucs2" | "base64" | "base64url" | "latin1" | "binary" | "hex";
/** @category Plugin APIs */
interface RolldownDirectoryEntry {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  name: string;
}
/** @category Plugin APIs */
interface RolldownFileStats {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mtime: Date;
  ctime: Date;
  atime: Date;
  birthtime: Date;
} //#endregion
//#region src/plugin/hook-filter.d.ts
/** @category Plugin APIs */
type GeneralHookFilter<Value = StringOrRegExp> = MaybeArray$2<Value> | {
  include?: MaybeArray$2<Value>;
  exclude?: MaybeArray$2<Value>;
};
interface FormalModuleTypeFilter {
  include?: ModuleType[];
}
/** @category Plugin APIs */
type ModuleTypeFilter = ModuleType[] | FormalModuleTypeFilter;
/**
* A filter to be used to do a pre-test to determine whether the hook should be called.
*
* See [Plugin Hook Filters page](https://rolldown.rs/apis/plugin-api/hook-filters) for more details.
*
* @category Plugin APIs
*/
interface HookFilter {
  /**
  * A filter based on the module `id`.
  *
  * If the value is a string, it is treated as a glob pattern.
  * The string type is not available for {@linkcode Plugin.resolveId | resolveId} hook.
  *
  * @example
  * Include all `id`s that contain `node_modules` in the path.
  * ```js
  * { id: '**'+'/node_modules/**' }
  * ```
  * @example
  * Include all `id`s that contain `node_modules` or `src` in the path.
  * ```js
  * { id: ['**'+'/node_modules/**', '**'+'/src/**'] }
  * ```
  * @example
  * Include all `id`s that start with `http`
  * ```js
  * { id: /^http/ }
  * ```
  * @example
  * Exclude all `id`s that contain `node_modules` in the path.
  * ```js
  * { id: { exclude: '**'+'/node_modules/**' } }
  * ```
  * @example
  * Formal pattern to define includes and excludes.
  * ```js
  * { id : {
  *   include: ['**'+'/foo/**', /bar/],
  *   exclude: ['**'+'/baz/**', /qux/]
  * }}
  * ```
  */
  id?: GeneralHookFilter;
  /**
  * A filter based on the module's `moduleType`.
  *
  * Only available for {@linkcode Plugin.transform | transform} hook.
  */
  moduleType?: ModuleTypeFilter;
  /**
  * A filter based on the module's code.
  *
  * Only available for {@linkcode Plugin.transform | transform} hook.
  */
  code?: GeneralHookFilter;
} //#endregion
//#region src/plugin/minimal-plugin-context.d.ts
/** @category Plugin APIs */
interface PluginContextMeta {
  /**
  * A property for Rollup compatibility. A dummy value is set by Rolldown.
  * @example `'4.23.0'`
  */
  rollupVersion: string;
  /**
  * The currently running version of Rolldown.
  * @example `'1.0.0'`
  */
  rolldownVersion: string;
  /**
  * Whether Rolldown was started via {@linkcode watch | rolldown.watch()} or
  * from the command line with `--watch`.
  */
  watchMode: boolean;
}
/** @category Plugin APIs */
interface MinimalPluginContext {
  /** @hidden */
  readonly pluginName: string;
  /**
  * Similar to {@linkcode warn | this.warn}, except that it will also abort
  * the bundling process with an error.
  *
  * If an Error instance is passed, it will be used as-is, otherwise a new Error
  * instance will be created with the given error message and all additional
  * provided properties.
  *
  * In all hooks except the {@linkcode Plugin.onLog | onLog} hook, the error will
  * be augmented with {@linkcode RolldownLog.code | code: "PLUGIN_ERROR"} and
  * {@linkcode RolldownLog.plugin | plugin: plugin.name} properties.
  * If a `code` property already exists and the code does not start with `PLUGIN_`,
  * it will be renamed to {@linkcode RolldownLog.pluginCode | pluginCode}.
  *
  * @group Logging Methods
  */
  error: (e: RolldownError | string) => never;
  /**
  * Generate a `"info"` level log.
  *
  * {@linkcode RolldownLog.code | code} will be set to `"PLUGIN_LOG"` by Rolldown.
  * As these logs are displayed by default, use them for information that is not a warning
  * but makes sense to display to all users on every build.
  *
  *
  *
  * @inlineType LoggingFunction
  * @group Logging Methods
  */
  info: LoggingFunction;
  /**
  * Generate a `"warn"` level log.
  *
  * Just like internally generated warnings, these logs will be first passed to and
  * filtered by plugin {@linkcode Plugin.onLog | onLog} hooks before they are forwarded
  * to custom {@linkcode InputOptions.onLog | onLog} or
  * {@linkcode InputOptions.onwarn | onwarn} handlers or printed to the console.
  *
  * We encourage you to use objects with a {@linkcode RolldownLog.pluginCode | pluginCode}
  * property as that will allow users to easily filter for those logs in an `onLog` handler.
  *
  *
  *
  * @inlineType LoggingFunction
  * @group Logging Methods
  */
  warn: LoggingFunction;
  /**
  * Generate a `"debug"` level log.
  *
  * {@linkcode RolldownLog.code | code} will be set to `"PLUGIN_LOG"` by Rolldown.
  * Make sure to add a distinctive {@linkcode RolldownLog.pluginCode | pluginCode} to
  * those logs for easy filtering.
  *
  *
  *
  * @inlineType LoggingFunction
  * @group Logging Methods
  */
  debug: LoggingFunction;
  /** An object containing potentially useful metadata. */
  meta: PluginContextMeta;
} //#endregion
//#region src/plugin/parallel-plugin.d.ts
type ParallelPlugin = {
  _parallel: {
    fileUrl: string;
    options: unknown;
  };
};
/** @internal */
//#endregion
//#region src/plugin/plugin-context.d.ts
/**
* Either a {@linkcode name} or a {@linkcode fileName} can be supplied.
* If a {@linkcode fileName} is provided, it will be used unmodified as the name
* of the generated file, throwing an error if this causes a conflict.
* Otherwise, if a {@linkcode name} is supplied, this will be used as substitution
* for `[name]` in the corresponding
* {@linkcode OutputOptions.assetFileNames | output.assetFileNames} pattern, possibly
* adding a unique number to the end of the file name to avoid conflicts.
* If neither a {@linkcode name} nor {@linkcode fileName} is supplied, a default name will be used.
*
* @category Plugin APIs
*/
interface EmittedAsset {
  type: "asset";
  name?: string;
  fileName?: string;
  /**
  * An absolute path to the original file if this asset corresponds to a file on disk.
  *
  * This property will be passed on to subsequent plugin hooks that receive a
  * {@linkcode PreRenderedAsset} or an {@linkcode OutputAsset} like
  * {@linkcode Plugin.generateBundle | generateBundle}.
  * In watch mode, Rolldown will also automatically watch this file for changes and
  * trigger a rebuild if it changes. Therefore, it is not necessary to call
  * {@linkcode PluginContext.addWatchFile | this.addWatchFile} for this file.
  */
  originalFileName?: string;
  source: AssetSource;
}
/**
* Either a {@linkcode name} or a {@linkcode fileName} can be supplied.
* If a {@linkcode fileName} is provided, it will be used unmodified as the name
* of the generated file, throwing an error if this causes a conflict.
* Otherwise, if a {@linkcode name} is supplied, this will be used as substitution
* for `[name]` in the corresponding
* {@linkcode OutputOptions.chunkFileNames | output.chunkFileNames} pattern, possibly
* adding a unique number to the end of the file name to avoid conflicts.
* If neither a {@linkcode name} nor {@linkcode fileName} is supplied, a default name will be used.
*
* @category Plugin APIs
*/
interface EmittedChunk {
  type: "chunk";
  name?: string;
  fileName?: string;
  /**
  * When provided, this will override
  * {@linkcode InputOptions.preserveEntrySignatures | preserveEntrySignatures} for this particular
  * chunk.
  */
  preserveSignature?: "strict" | "allow-extension" | "exports-only" | false;
  /**
  * The module id of the entry point of the chunk.
  *
  * It will be passed through build hooks just like regular entry points,
  * starting with {@linkcode Plugin.resolveId | resolveId}.
  */
  id: string;
  /**
  * The value to be passed to {@linkcode Plugin.resolveId | resolveId}'s {@linkcode importer} parameter when resolving the entry point.
  * This is important to properly resolve relative paths. If it is not provided,
  * paths will be resolved relative to the current working directory.
  */
  importer?: string;
}
/** @category Plugin APIs */
interface EmittedPrebuiltChunk {
  type: "prebuilt-chunk";
  fileName: string;
  /**
  * A semantic name for the chunk. If not provided, `fileName` will be used.
  */
  name?: string;
  /**
  * The code of this chunk.
  */
  code: string;
  /**
  * The list of exported variable names from this chunk.
  *
  * This should be provided if the chunk exports any variables.
  */
  exports?: string[];
  /**
  * The corresponding source map for this chunk.
  */
  map?: SourceMap$1;
  sourcemapFileName?: string;
  /**
  * The module id of the facade module for this chunk, if any.
  */
  facadeModuleId?: string;
  /**
  * Whether this chunk corresponds to an entry point.
  */
  isEntry?: boolean;
  /**
  * Whether this chunk corresponds to a dynamic entry point.
  */
  isDynamicEntry?: boolean;
}
/** @inline @category Plugin APIs */
type EmittedFile = EmittedAsset | EmittedChunk | EmittedPrebuiltChunk;
/** @category Plugin APIs */
interface PluginContextResolveOptions {
  /**
  * The value for {@linkcode ResolveIdExtraOptions.kind | kind} passed to
  * {@linkcode Plugin.resolveId | resolveId} hooks.
  */
  kind?: BindingPluginContextResolveOptions["importKind"];
  /**
  * The value for {@linkcode ResolveIdExtraOptions.isEntry | isEntry} passed to
  * {@linkcode Plugin.resolveId | resolveId} hooks.
  *
  * @default `false` if there's an importer, `true` otherwise.
  */
  isEntry?: boolean;
  /**
  * Whether the {@linkcode Plugin.resolveId | resolveId} hook of the plugin from
  * which {@linkcode PluginContext.resolve | this.resolve} is called will be skipped
  * when resolving.
  *
  *
  *
  * @default true
  */
  skipSelf?: boolean;
  /**
  * Plugin-specific options.
  *
  * See [Custom resolver options section](https://rolldown.rs/apis/plugin-api/inter-plugin-communication#custom-resolver-options) for more details.
  */
  custom?: CustomPluginOptions;
}
/** @inline */
type GetModuleInfo = (moduleId: string) => ModuleInfo | null;
/** @category Plugin APIs */
interface PluginContext extends MinimalPluginContext {
  /**
  * Provides abstract access to the file system.
  */
  fs: RolldownFsModule;
  /**
  * Emits a new file that is included in the build output.
  * You can emit chunks, prebuilt chunks or assets.
  *
  *
  *
  * @returns A `referenceId` for the emitted file that can be used in various places to reference the emitted file.
  */
  emitFile(file: EmittedFile): string;
  /**
  * Get the file name of a chunk or asset that has been emitted via
  * {@linkcode emitFile | this.emitFile}.
  *
  * @returns The file name of the emitted file. Relative to {@linkcode OutputOptions.dir | output.dir}.
  */
  getFileName(referenceId: string): string;
  /**
  * Get all module ids in the current module graph.
  *
  * @returns
  * An iterator of module ids. It can be iterated via
  * ```js
  * for (const moduleId of this.getModuleIds()) {
  *   // ...
  * }
  * ```
  * or converted into an array via `Array.from(this.getModuleIds())`.
  */
  getModuleIds(): IterableIterator<string>;
  /**
  * Get additional information about the module in question.
  *
  *
  *
  * @returns Module information for that module. `null` if the module could not be found.
  * @group Methods
  */
  getModuleInfo: GetModuleInfo;
  /**
  * Adds additional files to be monitored in watch mode so that changes to these files will trigger rebuilds.
  *
  *
  */
  addWatchFile(id: string): void;
  /**
  * Loads and parses the module corresponding to the given id, attaching additional
  * meta information to the module if provided. This will trigger the same
  * {@linkcode Plugin.load | load}, {@linkcode Plugin.transform | transform} and
  * {@linkcode Plugin.moduleParsed | moduleParsed} hooks as if the module was imported
  * by another module.
  *
  *
  */
  load(options: {
    id: string;
    resolveDependencies?: boolean;
  } & Partial<PartialNull<ModuleOptions>>): Promise<ModuleInfo>;
  /**
  * Use Rolldown's internal parser to parse code to an [ESTree-compatible](https://github.com/estree/estree) AST.
  */
  parse(input: string, options?: ParserOptions | null): Program;
  /**
  * Resolve imports to module ids (i.e. file names) using the same plugins that Rolldown uses,
  * and determine if an import should be external.
  *
  * When calling this function from a {@linkcode Plugin.resolveId | resolveId} hook, you should
  * always check if it makes sense for you to pass along the
  * {@link PluginContextResolveOptions | options}.
  *
  * @returns
  * If `Promise<null>` is returned, the import could not be resolved by Rolldown or any plugin
  * but was not explicitly marked as external by the user.
  * If an absolute external id is returned that should remain absolute in the output either
  * via the
  * {@linkcode InputOptions.makeAbsoluteExternalsRelative | makeAbsoluteExternalsRelative}
  * option or by explicit plugin choice in the {@linkcode Plugin.resolveId | resolveId} hook,
  * `external` will be `"absolute"` instead of `true`.
  */
  resolve(source: string, importer?: string, options?: PluginContextResolveOptions): Promise<ResolvedId | null>;
} //#endregion
//#region src/plugin/transform-plugin-context.d.ts
/** @category Plugin APIs */
interface TransformPluginContext extends PluginContext {
  /**
  * Same as {@linkcode PluginContext.debug}, but a `position` param can be supplied.
  *
  * @inlineType LoggingFunctionWithPosition
  * @group Logging Methods
  */
  debug: LoggingFunctionWithPosition;
  /**
  * Same as {@linkcode PluginContext.info}, but a `position` param can be supplied.
  *
  * @inlineType LoggingFunctionWithPosition
  * @group Logging Methods
  */
  info: LoggingFunctionWithPosition;
  /**
  * Same as {@linkcode PluginContext.warn}, but a `position` param can be supplied.
  *
  * @inlineType LoggingFunctionWithPosition
  * @group Logging Methods
  */
  warn: LoggingFunctionWithPosition;
  /**
  * Same as {@linkcode PluginContext.error}, but the `id` of the current module will
  * also be added and a `position` param can be supplied.
  */
  error(e: RolldownError | string, pos?: number | {
    column: number;
    line: number;
  }): never;
  /**
  * Get the combined source maps of all previous plugins.
  */
  getCombinedSourcemap(): SourceMap$1;
} //#endregion
//#region src/types/module-side-effects.d.ts
interface ModuleSideEffectsRule {
  test?: RegExp;
  external?: boolean;
  sideEffects: boolean;
}
type ModuleSideEffectsOption = boolean | readonly string[] | ModuleSideEffectsRule[] | ((id: string, external: boolean) => boolean | undefined) | "no-external";
/**
* When passing an object, you can fine-tune the tree-shaking behavior.
*/
type TreeshakingOptions = {
  /**
  * **Values:**
  *
  * - **`true`**: All modules are assumed to have side effects and will be included in the bundle even if none of their exports are used.
  * - **`false`**: No modules have side effects. This enables aggressive tree-shaking, removing any modules whose exports are not used.
  * - **`string[]`**: Array of module IDs that have side effects. Only modules in this list will be preserved if unused; all others can be tree-shaken when their exports are unused.
  * - **`'no-external'`**: Assumes no external modules have side effects while preserving the default behavior for local modules.
  * - **`ModuleSideEffectsRule[]`**: Array of rules with `test`, `external`, and `sideEffects` properties for fine-grained control.
  * - **`function`**: Function that receives `(id, external)` and returns whether the module has side effects.
  *
  * **Important:** Setting this to `false` or using an array/string assumes that your modules and their dependencies have no side effects other than their exports. Only use this if you're certain that removing unused modules won't break your application.
  *
  * > [!NOTE]
  * > **Performance: Prefer `ModuleSideEffectsRule[]` over functions**
  * >
  * > When possible, use rule-based configuration instead of functions. Rules are processed entirely in Rust, while JavaScript functions require runtime calls between Rust and JavaScript, which can hurt CPU utilization during builds.
  * >
  * > **Functions should be a last resort**: Only use the function signature when your logic cannot be expressed with patterns or simple string matching.
  * >
  * > **Rule advantages**: `ModuleSideEffectsRule[]` provides better performance by avoiding Rust-JavaScript runtime calls, clearer intent, and easier maintenance.
  *
  * @example
  * ```js
  * // Assume no modules have side effects (aggressive tree-shaking)
  * treeshake: {
  *   moduleSideEffects: false
  * }
  *
  * // Only specific modules have side effects (string array)
  * treeshake: {
  *   moduleSideEffects: [
  *     'lodash',
  *     'react-dom',
  *   ]
  * }
  *
  * // Use rules for pattern matching and granular control
  * treeshake: {
  *   moduleSideEffects: [
  *     { test: /^node:/, sideEffects: true },
  *     { test: /\.css$/, sideEffects: true },
  *     { test: /some-package/, sideEffects: false, external: false },
  *   ]
  * }
  *
  * // Custom function to determine side effects
  * treeshake: {
  *   moduleSideEffects: (id, external) => {
  *     if (external) return false; // external modules have no side effects
  *     return id.includes('/side-effects/') || id.endsWith('.css');
  *   }
  * }
  *
  * // Assume no external modules have side effects
  * treeshake: {
  *   moduleSideEffects: 'no-external',
  * }
  * ```
  *
  * **Common Use Cases:**
  * - **CSS files**: `{ test: /\.css$/, sideEffects: true }` - preserve CSS imports
  * - **Polyfills**: Add specific polyfill modules to the array
  * - **Plugins**: Modules that register themselves globally on import
  * - **Library development**: Set to `false` for libraries where unused exports should be removed
  *
  * @default true
  */
  moduleSideEffects?: ModuleSideEffectsOption;
  /**
  * Whether to respect `/*@__PURE__*\/` annotations and other tree-shaking hints in the code.
  *
  * See [related Oxc documentation](https://oxc.rs/docs/guide/usage/minifier/dead-code-elimination#pure-annotations) for more details.
  *
  * @default true
  */
  annotations?: boolean;
  /**
  * Array of function names that should be considered pure (no side effects) even if they can't be automatically detected as pure.
  *
  * See [related Oxc documentation](https://oxc.rs/docs/guide/usage/minifier/dead-code-elimination#define-pure-functions) for more details.
  *
  * @example
  * ```js
  * treeshake: {
  *   manualPureFunctions: ['console.log', 'debug.trace']
  * }
  * ```
  * @default []
  */
  manualPureFunctions?: readonly string[];
  /**
  * Whether to assume that accessing unknown global properties might have side effects.
  *
  * See [related Oxc documentation](https://oxc.rs/docs/guide/usage/minifier/dead-code-elimination#ignoring-global-variable-access-side-effects) for more details.
  *
  * @default true
  */
  unknownGlobalSideEffects?: boolean;
  /**
  * Whether to assume that invalid import statements might have side effects.
  *
  * See [related Oxc documentation](https://oxc.rs/docs/guide/usage/minifier/dead-code-elimination#ignoring-invalid-import-statement-side-effects) for more details.
  *
  * @default true
  */
  invalidImportSideEffects?: boolean;
  /**
  * Whether to enable tree-shaking for CommonJS modules. When `true`, unused exports from CommonJS modules can be eliminated from the bundle, similar to ES modules. When disabled, CommonJS modules will always be included in their entirety.
  *
  * This option allows rolldown to analyze `exports.property` assignments in CommonJS modules and remove unused exports while preserving the module's side effects.
  *
  * @example
  * ```js
  * // source.js (CommonJS)
  * exports.used = 'This will be kept';
  * exports.unused = 'This will be tree-shaken away';
  *
  * // main.js
  * import { used } from './source.js';
  * // With commonjs: true, only the 'used' export is included in the bundle
  * // With commonjs: false, both exports are included
  * ```
  * @default true
  */
  commonjs?: boolean;
  /**
  * Controls whether reading properties from objects is considered to have side effects.
  *
  * Set to `false` for more aggressive tree-shaking behavior.
  *
  * See [related Oxc documentation](https://oxc.rs/docs/guide/usage/minifier/dead-code-elimination#ignoring-property-read-side-effects) for more details.
  *
  * @default 'always'
  */
  propertyReadSideEffects?: false | "always";
  /**
  * Controls whether writing properties to objects is considered to have side effects.
  *
  * Set to `false` for more aggressive behavior.
  *
  * @default 'always'
  */
  propertyWriteSideEffects?: false | "always";
}; //#endregion
//#region src/types/output-bundle.d.ts
/** @category Plugin APIs */
interface OutputBundle {
  [fileName: string]: OutputAsset | OutputChunk;
} //#endregion
//#region src/types/sourcemap.d.ts
/** @category Plugin APIs */
interface ExistingRawSourceMap {
  file?: string | null;
  mappings: string;
  names?: string[];
  sources?: (string | null)[];
  sourcesContent?: (string | null)[];
  sourceRoot?: string;
  version?: number;
  x_google_ignoreList?: number[];
}
/** @inline @category Plugin APIs */
type SourceMapInput = ExistingRawSourceMap | string | null; //#endregion
//#region src/constants/version.d.ts
/**
* The version of Rolldown.
* @example `'1.0.0'`
*
* @category Plugin APIs
*/
//#endregion
//#region src/builtin-plugin/utils.d.ts
declare class BuiltinPlugin {
  name: BindingBuiltinPluginName;
  _options?: unknown;
  /** Vite-specific option to control plugin ordering */
  enforce?: "pre" | "post";
  constructor(name: BindingBuiltinPluginName, _options?: unknown);
} //#endregion
//#region src/constants/plugin.d.ts
declare const ENUMERATED_INPUT_PLUGIN_HOOK_NAMES: readonly ["options", "buildStart", "resolveId", "load", "transform", "moduleParsed", "buildEnd", "onLog", "resolveDynamicImport", "closeBundle", "closeWatcher", "watchChange"];
declare const ENUMERATED_OUTPUT_PLUGIN_HOOK_NAMES: readonly ["augmentChunkHash", "outputOptions", "renderChunk", "renderStart", "renderError", "writeBundle", "generateBundle"];
declare const ENUMERATED_PLUGIN_HOOK_NAMES: [...typeof ENUMERATED_INPUT_PLUGIN_HOOK_NAMES, ...typeof ENUMERATED_OUTPUT_PLUGIN_HOOK_NAMES, "footer", "banner", "intro", "outro"];
/**
* Names of all defined hooks. It's like
* ```ts
* type DefinedHookNames = {
*   options: 'options',
*   buildStart: 'buildStart',
*   ...
* }
* ```
*/
type DefinedHookNames = { readonly [K in (typeof ENUMERATED_PLUGIN_HOOK_NAMES)[number]]: K };
/**
* Names of all defined hooks. It's like
* ```js
* const DEFINED_HOOK_NAMES ={
*   options: 'options',
*   buildStart: 'buildStart',
*   ...
* }
* ```
*/
declare const DEFINED_HOOK_NAMES: DefinedHookNames; //#endregion
//#region src/plugin/with-filter.d.ts
//#endregion
//#region src/plugin/index.d.ts
type ModuleSideEffects = boolean | "no-treeshake" | null;
/** @category Plugin APIs */
type ModuleType = "js" | "jsx" | "ts" | "tsx" | "json" | "text" | "base64" | "dataurl" | "binary" | "empty" | (string & {});
/** @category Plugin APIs */
/** @category Plugin APIs */
interface CustomPluginOptions {
  [plugin: string]: any;
}
/** @category Plugin APIs */
interface ModuleOptions {
  moduleSideEffects: ModuleSideEffects;
  /** See [Custom module meta-data section](https://rolldown.rs/apis/plugin-api/inter-plugin-communication#custom-module-meta-data) for more details. */
  meta: CustomPluginOptions;
  invalidate?: boolean;
  packageJsonPath?: string;
}
/** @category Plugin APIs */
interface ResolvedId extends ModuleOptions {
  external: boolean | "absolute";
  id: string;
}
interface SpecifiedModuleOptions {
  /**
  * Indicates whether the module has side effects to Rolldown.
  *
  * - If `false` is set and no other module imports anything from this module, then this module will not be included in the bundle even if the module would have side effects.
  * - If `true` is set, Rolldown will use its default algorithm to include all statements in the module that has side effects.
  * - If `"no-treeshake"` is set, treeshaking will be disabled for this module, and this module will be included in one of the chunks even if it is empty.
  *
  * The precedence of this option is as follows (highest to lowest):
  * 1. {@linkcode Plugin.transform | transform} hook's returned `moduleSideEffects` option
  * 2. {@linkcode Plugin.load | load} hook's returned `moduleSideEffects` option
  * 3. {@linkcode Plugin.resolveId | resolveId} hook's returned `moduleSideEffects` option
  * 4. {@linkcode TreeshakingOptions.moduleSideEffects | treeshake.moduleSideEffects} option
  * 5. `sideEffects` field in the `package.json` file
  * 6. `true` (default)
  */
  moduleSideEffects?: ModuleSideEffects | null;
}
/** @category Plugin APIs */
interface PartialResolvedId extends SpecifiedModuleOptions, Partial<PartialNull<ModuleOptions>> {
  /**
  * Whether this id should be treated as external.
  *
  * Relative external ids, i.e. ids starting with `./` or `../`, will not be internally
  * converted to an absolute id and converted back to a relative id in the output,
  * but are instead included in the output unchanged.
  * If you want relative ids to be re-normalized and deduplicated instead, return
  * an absolute file system location as id and choose `external: "relative"`.
  *
  * - If `true`, absolute ids will be converted to relative ids based on the user's choice for the {@linkcode InputOptions.makeAbsoluteExternalsRelative | makeAbsoluteExternalsRelative} option.
  * - If `'relative'`, absolute ids will always be converted to relative ids.
  * - If `'absolute'`, absolute ids will always be kept as absolute ids.
  */
  external?: boolean | "absolute" | "relative";
  id: string;
}
/** @category Plugin APIs */
interface SourceDescription extends SpecifiedModuleOptions, Partial<PartialNull<ModuleOptions>> {
  code: string;
  /**
  * The source map for the transformation.
  *
  * If the transformation does not move code, you can preserve existing sourcemaps by setting this to `null`.
  *
  * See [Source Code Transformations section](https://rolldown.rs/apis/plugin-api/transformations#source-code-transformations) for more details.
  */
  map?: SourceMapInput;
  moduleType?: ModuleType;
}
/** @inline */
interface ResolveIdExtraOptions {
  /**
  * Plugin-specific options.
  *
  * See [Custom resolver options section](https://rolldown.rs/apis/plugin-api/inter-plugin-communication#custom-resolver-options) for more details.
  */
  custom?: CustomPluginOptions;
  /**
  * Whether this is resolution for an entry point.
  *
  *
  */
  isEntry: boolean;
  /**
  * The kind of import being resolved.
  *
  * - `import-statement`: `import { foo } from './lib.js';`
  * - `dynamic-import`: `import('./lib.js')`
  * - `require-call`: `require('./lib.js')`
  * - `import-rule`: `@import 'bg-color.css'` (experimental)
  * - `url-token`: `url('./icon.png')` (experimental)
  * - `new-url`: `new URL('./worker.js', import.meta.url)` (experimental)
  * - `hot-accept`: `import.meta.hot.accept('./lib.js', () => {})` (experimental)
  */
  kind: BindingHookResolveIdExtraArgs["kind"];
}
/** @inline @category Plugin APIs */
type ResolveIdResult = string | NullValue | false | PartialResolvedId;
/** @inline @category Plugin APIs */
type LoadResult = NullValue | string | SourceDescription;
/** @inline @category Plugin APIs */
type TransformResult = NullValue | string | (Omit<SourceDescription, "code"> & {
  code?: string | BindingMagicString;
});
type RenderedChunkMeta = {
  /**
  * Contains information about all chunks that are being rendered.
  * This is useful to explore the entire chunk graph.
  */
  chunks: Record<string, RenderedChunk>;
  /**
  * A lazily-created MagicString instance for the chunk's code.
  * Use this to perform string transformations with automatic source map support.
  * This is only available when `experimental.nativeMagicString` is enabled.
  */
  magicString?: BindingMagicString;
};
/** @category Plugin APIs */
interface FunctionPluginHooks {
  /**
  * A function that receives and filters logs and warnings generated by Rolldown and
  * plugins before they are passed to the {@linkcode InputOptions.onLog | onLog} option
  * or printed to the console.
  *
  * If `false` is returned, the log will be filtered out.
  * Otherwise, the log will be handed to the `onLog` hook of the next plugin,
  * the {@linkcode InputOptions.onLog | onLog} option, or printed to the console.
  * Plugins can also change the log level of a log or turn a log into an error by passing
  * the `log` object to {@linkcode MinimalPluginContext.error | this.error},
  * {@linkcode MinimalPluginContext.warn | this.warn},
  * {@linkcode MinimalPluginContext.info | this.info} or
  * {@linkcode MinimalPluginContext.debug | this.debug} and returning `false`.
  *
  *
  *
  * @group Build Hooks
  */
  [DEFINED_HOOK_NAMES.onLog]: (this: MinimalPluginContext, level: LogLevel$1, log: RolldownLog) => NullValue | boolean;
  /**
  * Replaces or manipulates the options object passed to {@linkcode rolldown | rolldown()}.
  *
  * Returning `null` does not replace anything.
  *
  * If you just need to read the options, it is recommended to use
  * the {@linkcode buildStart} hook as that hook has access to the options
  * after the transformations from all `options` hooks have been taken into account.
  *
  * @group Build Hooks
  */
  [DEFINED_HOOK_NAMES.options]: (this: MinimalPluginContext, options: InputOptions) => NullValue | InputOptions;
  /**
  * Replaces or manipulates the output options object passed to
  * {@linkcode RolldownBuild.generate | bundle.generate()} or
  * {@linkcode RolldownBuild.write | bundle.write()}.
  *
  * Returning null does not replace anything.
  *
  * If you just need to read the output options, it is recommended to use
  * the {@linkcode renderStart} hook as this hook has access to the output options
  * after the transformations from all `outputOptions` hooks have been taken into account.
  *
  * @group Build Hooks
  */
  [DEFINED_HOOK_NAMES.outputOptions]: (this: MinimalPluginContext, options: OutputOptions) => NullValue | OutputOptions;
  /**
  * Called on each {@linkcode rolldown | rolldown()} build.
  *
  * This is the recommended hook to use when you need access to the options passed to {@linkcode rolldown | rolldown()} as it takes the transformations by all options hooks into account and also contains the right default values for unset options.
  *
  * @group Build Hooks
  */
  [DEFINED_HOOK_NAMES.buildStart]: (this: PluginContext, options: NormalizedInputOptions) => void;
  /**
  * Defines a custom resolver.
  *
  * A resolver can be useful for e.g. locating third-party dependencies.
  *
  * Returning `null` defers to other `resolveId` hooks and eventually the default resolution behavior.
  * Returning `false` signals that `source` should be treated as an external module and not included in the bundle. If this happens for a relative import, the id will be renormalized the same way as when the {@linkcode InputOptions.external} option is used.
  * If you return an object, then it is possible to resolve an import to a different id while excluding it from the bundle at the same time.
  *
  * Note that while `resolveId` will be called for each import of a module and can therefore
  * resolve to the same `id` many times, values for `external`, `meta` or `moduleSideEffects`
  * can only be set once before the module is loaded. The reason is that after this call,
  * Rolldown will continue with the {@linkcode load} and {@linkcode transform} hooks for that
  * module that may override these values and should take precedence if they do so.
  *
  * @group Build Hooks
  */
  [DEFINED_HOOK_NAMES.resolveId]: (this: PluginContext, source: string, importer: string | undefined, extraOptions: ResolveIdExtraOptions) => ResolveIdResult;
  /**
  * Defines a custom resolver for dynamic imports.
  *
  * @deprecated
  * This hook exists only for Rollup compatibility. Please use {@linkcode resolveId} instead.
  *
  * @group Build Hooks
  */
  [DEFINED_HOOK_NAMES.resolveDynamicImport]: (this: PluginContext, source: string, importer: string | undefined) => ResolveIdResult;
  /**
  * Defines a custom loader.
  *
  * Returning `null` defers to other `load` hooks or the built-in loading mechanism.
  *
  * You can use {@linkcode PluginContext.getModuleInfo | this.getModuleInfo()} to find out the previous values of `meta`, `moduleSideEffects` inside this hook.
  *
  * @group Build Hooks
  */
  [DEFINED_HOOK_NAMES.load]: (this: PluginContext, id: string) => MaybePromise$1<LoadResult>;
  /**
  * Can be used to transform individual modules.
  *
  * Note that it's possible to return only properties and no code transformations.
  *
  * You can use {@linkcode PluginContext.getModuleInfo | this.getModuleInfo()} to find out the previous values of `meta`, `moduleSideEffects` inside this hook.
  *
  * @group Build Hooks
  */
  [DEFINED_HOOK_NAMES.transform]: (this: TransformPluginContext, code: string, id: string, meta: BindingTransformHookExtraArgs & {
    moduleType: ModuleType;
    magicString?: BindingMagicString;
    ast?: Program;
  }) => TransformResult;
  /**
  * This hook is called each time a module has been fully parsed by Rolldown.
  *
  * This hook will wait until all imports are resolved so that the information in
  * {@linkcode ModuleInfo.importedIds | moduleInfo.importedIds},
  * {@linkcode ModuleInfo.dynamicallyImportedIds | moduleInfo.dynamicallyImportedIds}
  * are complete and accurate. Note however that information about importing modules
  * may be incomplete as additional importers could be discovered later.
  * If you need this information, use the {@linkcode buildEnd} hook.
  *
  * @group Build Hooks
  */
  [DEFINED_HOOK_NAMES.moduleParsed]: (this: PluginContext, moduleInfo: ModuleInfo) => void;
  /**
  * Called when Rolldown has finished bundling, but before Output Generation Hooks.
  * If an error occurred during the build, it is passed on to this hook.
  *
  * @group Build Hooks
  */
  [DEFINED_HOOK_NAMES.buildEnd]: (this: PluginContext, err?: Error) => void;
  /**
  * Called initially each time {@linkcode RolldownBuild.generate | bundle.generate()} or
  * {@linkcode RolldownBuild.write | bundle.write()} is called.
  *
  * To get notified when generation has completed, use the {@linkcode generateBundle} and
  * {@linkcode renderError} hooks.
  *
  * This is the recommended hook to use when you need access to the output options passed to
  * {@linkcode RolldownBuild.generate | bundle.generate()} or
  * {@linkcode RolldownBuild.write | bundle.write()} as it takes the transformations by all outputOptions hooks into account and also contains the right default values for unset options.
  *
  * It also receives the input options passed to {@linkcode rolldown | rolldown()} so that
  * plugins that can be used as output plugins, i.e. plugins that only use generate phase hooks,
  * can get access to them.
  *
  * @group Output Generation Hooks
  */
  [DEFINED_HOOK_NAMES.renderStart]: (this: PluginContext, outputOptions: NormalizedOutputOptions, inputOptions: NormalizedInputOptions) => void;
  /**
  * Can be used to transform individual chunks. Called for each Rolldown output chunk file.
  *
  * Returning null will apply no transformations. If you change code in this hook and want to support source maps, you need to return a map describing your changes, see [Source Code Transformations section](https://rolldown.rs/apis/plugin-api/transformations#source-code-transformations).
  *
  * `chunk` is mutable and changes applied in this hook will propagate to other plugins and
  * to the generated bundle.
  * That means if you add or remove imports or exports in this hook, you should update
  * {@linkcode RenderedChunk.imports | imports}, {@linkcode RenderedChunk.importedBindings | importedBindings} and/or {@linkcode RenderedChunk.exports | exports} accordingly.
  *
  * @group Output Generation Hooks
  */
  [DEFINED_HOOK_NAMES.renderChunk]: (this: PluginContext, code: string, chunk: RenderedChunk, outputOptions: NormalizedOutputOptions, meta: RenderedChunkMeta) => NullValue | string | BindingMagicString | {
    code: string | BindingMagicString;
    map?: SourceMapInput;
  };
  /**
  * Can be used to augment the hash of individual chunks. Called for each Rolldown output chunk.
  *
  * Returning a falsy value will not modify the hash.
  * Truthy values will be used as an additional source for hash calculation.
  *
  *
  *
  * @group Output Generation Hooks
  */
  [DEFINED_HOOK_NAMES.augmentChunkHash]: (this: PluginContext, chunk: RenderedChunk) => string | void;
  /**
  * Called when Rolldown encounters an error during
  * {@linkcode RolldownBuild.generate | bundle.generate()} or
  * {@linkcode RolldownBuild.write | bundle.write()}.
  *
  * To get notified when generation completes successfully, use the
  * {@linkcode generateBundle} hook.
  *
  * @group Output Generation Hooks
  */
  [DEFINED_HOOK_NAMES.renderError]: (this: PluginContext, error: Error) => void;
  /**
  * Called at the end of {@linkcode RolldownBuild.generate | bundle.generate()} or
  * immediately before the files are written in
  * {@linkcode RolldownBuild.write | bundle.write()}.
  *
  * To modify the files after they have been written, use the {@linkcode writeBundle} hook.
  *
  *
  *
  * @group Output Generation Hooks
  */
  [DEFINED_HOOK_NAMES.generateBundle]: (this: PluginContext, outputOptions: NormalizedOutputOptions, bundle: OutputBundle, isWrite: boolean) => void;
  /**
  * Called only at the end of {@linkcode RolldownBuild.write | bundle.write()} once
  * all files have been written.
  *
  * @group Output Generation Hooks
  */
  [DEFINED_HOOK_NAMES.writeBundle]: (this: PluginContext, outputOptions: NormalizedOutputOptions, bundle: OutputBundle) => void;
  /**
  * Can be used to clean up any external service that may be running.
  *
  * Rolldown's CLI will make sure this hook is called after each run, but it is the responsibility
  * of users of the JavaScript API to manually call
  * {@linkcode RolldownBuild.close | bundle.close()} once they are done generating bundles.
  * For that reason, any plugin relying on this feature should carefully mention this in
  * its documentation.
  *
  * If a plugin wants to retain resources across builds in watch mode, they can check for
  * {@linkcode PluginContextMeta.watchMode | this.meta.watchMode} in this hook and perform
  * the necessary cleanup for watch mode in closeWatcher.
  *
  * @group Output Generation Hooks
  */
  [DEFINED_HOOK_NAMES.closeBundle]: (this: PluginContext, error?: Error) => void;
  /**
  * Notifies a plugin whenever Rolldown has detected a change to a monitored file in watch mode.
  *
  * If a build is currently running, this hook is called once the build finished.
  * It will be called once for every file that changed.
  *
  * This hook cannot be used by output plugins.
  *
  * If you need to be notified immediately when a file changed, you can use the {@linkcode WatcherOptions.onInvalidate | watch.onInvalidate} option.
  *
  * @group Build Hooks
  */
  [DEFINED_HOOK_NAMES.watchChange]: (this: PluginContext, id: string, event: {
    event: ChangeEvent;
  }) => void;
  /**
  * Notifies a plugin when the watcher process will close so that all open resources can be closed too.
  *
  * This hook cannot be used by output plugins.
  *
  * @group Build Hooks
  */
  [DEFINED_HOOK_NAMES.closeWatcher]: (this: PluginContext) => void;
}
type ChangeEvent = "create" | "update" | "delete";
type PluginOrder = "pre" | "post" | null;
/** @inline */
type ObjectHookMeta = {
  order?: PluginOrder;
};
/**
* A hook in a function or an object form with additional properties.
*
* @typeParam T - The type of the hook function.
* @typeParam O - Additional properties that are specific to some hooks.
*
*
*
* @category Plugin APIs
*/
type ObjectHook<T, O = {}> = T | ({
  handler: T;
} & ObjectHookMeta & O);
type SyncPluginHooks = DefinedHookNames["augmentChunkHash" | "onLog" | "outputOptions"];
/** @category Plugin APIs */
type AsyncPluginHooks = Exclude<keyof FunctionPluginHooks, SyncPluginHooks>;
type FirstPluginHooks = DefinedHookNames["load" | "resolveDynamicImport" | "resolveId"];
type SequentialPluginHooks = DefinedHookNames["augmentChunkHash" | "generateBundle" | "onLog" | "options" | "outputOptions" | "renderChunk" | "transform"];
interface AddonHooks {
  /**
  * A hook equivalent to {@linkcode OutputOptions.banner | output.banner} option.
  *
  * @group Output Generation Hooks
  */
  [DEFINED_HOOK_NAMES.banner]: AddonHook;
  /**
  * A hook equivalent to {@linkcode OutputOptions.footer | output.footer} option.
  *
  * @group Output Generation Hooks
  */
  [DEFINED_HOOK_NAMES.footer]: AddonHook;
  /**
  * A hook equivalent to {@linkcode OutputOptions.intro | output.intro} option.
  *
  * @group Output Generation Hooks
  */
  [DEFINED_HOOK_NAMES.intro]: AddonHook;
  /**
  * A hook equivalent to {@linkcode OutputOptions.outro | output.outro} option.
  *
  * @group Output Generation Hooks
  */
  [DEFINED_HOOK_NAMES.outro]: AddonHook;
}
type OutputPluginHooks = DefinedHookNames["augmentChunkHash" | "generateBundle" | "outputOptions" | "renderChunk" | "renderError" | "renderStart" | "writeBundle"];
/** @internal */
type ParallelPluginHooks = Exclude<keyof FunctionPluginHooks | keyof AddonHooks, FirstPluginHooks | SequentialPluginHooks>;
/** @category Plugin APIs */
type HookFilterExtension<K extends keyof FunctionPluginHooks> = K extends "transform" ? {
  filter?: HookFilter | TopLevelFilterExpression[];
} : K extends "load" ? {
  filter?: Pick<HookFilter, "id"> | TopLevelFilterExpression[];
} : K extends "resolveId" ? {
  filter?: {
    id?: GeneralHookFilter<RegExp>;
  } | TopLevelFilterExpression[];
} : K extends "renderChunk" ? {
  filter?: Pick<HookFilter, "code"> | TopLevelFilterExpression[];
} : {};
type PluginHooks = { [K in keyof FunctionPluginHooks]: ObjectHook<K extends AsyncPluginHooks ? MakeAsync<FunctionPluginHooks[K]> : FunctionPluginHooks[K], HookFilterExtension<K> & (K extends ParallelPluginHooks ? {
  /**
  * @deprecated
  * this is only for rollup Plugin type compatibility.
  * hooks always work as `sequential: true`.
  */
  sequential?: boolean;
} : {})> };
type AddonHookFunction = (this: PluginContext, chunk: RenderedChunk) => string | Promise<string>;
type AddonHook = string | AddonHookFunction;
interface OutputPlugin extends Partial<{ [K in keyof PluginHooks as K & OutputPluginHooks]: PluginHooks[K] }>, Partial<{ [K in keyof AddonHooks]: ObjectHook<AddonHook> }> {
  /** The name of the plugin, for use in error messages and logs. */
  name: string;
  /** The version of the plugin, for use in inter-plugin communication scenarios. */
  version?: string;
}
/**
* The Plugin interface.
*
* See [Plugin API document](https://rolldown.rs/apis/plugin-api) for details.
*
* @typeParam A - The type of the {@link Plugin.api | api} property.
*
* @category Plugin APIs
*/
interface Plugin$1<A = any> extends OutputPlugin, Partial<PluginHooks> {
  /**
  * Used for inter-plugin communication.
  */
  api?: A;
}
type RolldownPlugin<A = any> = Plugin$1<A> | BuiltinPlugin | ParallelPlugin;
type RolldownPluginOption<A = any> = MaybePromise$1<NullValue<RolldownPlugin<A>> | {
  name: string;
} | false | RolldownPluginOption[]>;
type RolldownOutputPlugin = OutputPlugin | BuiltinPlugin;
type RolldownOutputPluginOption = MaybePromise$1<NullValue<RolldownOutputPlugin> | {
  name: string;
} | false | RolldownOutputPluginOption[]>; //#endregion
//#region src/options/input-options.d.ts
/**
* @inline
*/
type InputOption = string | string[] | Record<string, string>;
/**
* @param id The id of the module being checked.
* @param parentId The id of the module importing the id being checked.
* @param isResolved Whether the id has been resolved.
* @returns Whether the module should be treated as external.
*/
type ExternalOptionFunction = (id: string, parentId: string | undefined, isResolved: boolean) => NullValue<boolean>;
/** @inline */
type ExternalOption = StringOrRegExp | StringOrRegExp[] | ExternalOptionFunction;
type ModuleTypes = Record<string, "js" | "jsx" | "ts" | "tsx" | "json" | "text" | "base64" | "dataurl" | "binary" | "empty" | "css" | "asset">;
interface WatcherOptions {
  /**
  * Whether to skip the {@linkcode RolldownBuild.write | bundle.write()} step when a rebuild is triggered.
  * @default false
  */
  skipWrite?: boolean;
  /**
  * Configures how long Rolldown will wait for further changes until it triggers
  * a rebuild in milliseconds.
  *
  * Even if this value is set to 0, there's a small debounce timeout configured
  * in the file system watcher. Setting this to a value greater than 0 will mean
  * that Rolldown will only trigger a rebuild if there was no change for the
  * configured number of milliseconds. If several configurations are watched,
  * Rolldown will use the largest configured build delay.
  *
  * This option is useful if you use a tool that regenerates multiple source files
  * very slowly. Rebuilding immediately after the first change could cause Rolldown
  * to generate a broken intermediate build before generating a successful final
  * build, which can be confusing and distracting.
  *
  * @default 0
  */
  buildDelay?: number;
  /**
  * An optional object of options that will be passed to the [notify](https://github.com/rolldown/notify) file watcher.
  */
  notify?: {
    /**
    * Interval between each re-scan attempt in milliseconds.
    *
    * This option is only used when polling backend is used.
    *
    * @default 30_000
    */
    pollInterval?: number;
    /**
    * Whether to compare file contents when checking for changes.
    *
    * This is especially important for pseudo filesystems like those on Linux
    * under `/sys` and `/proc` which are not obligated to respect any other
    * filesystem norms such as modification timestamps, file sizes, etc. By
    * enabling this feature, performance will be significantly impacted as
    * all files will need to be read and hashed at each interval.
    *
    * This option is only used when polling backend is used.
    *
    * @default false
    */
    compareContents?: boolean;
  };
  /**
  * Filter to limit the file-watching to certain files.
  *
  * Strings are treated as glob patterns.
  * Note that this only filters the module graph but does not allow adding
  * additional watch files.
  *
  * @example
  * ```js
  * export default defineConfig({
  *   watch: {
  *     include: 'src/**',
  *   },
  * })
  * ```
  * @default []
  */
  include?: StringOrRegExp | StringOrRegExp[];
  /**
  * Filter to prevent files from being watched.
  *
  * Strings are treated as glob patterns.
  *
  * @example
  * ```js
  * export default defineConfig({
  *   watch: {
  *     exclude: 'node_modules/**',
  *   },
  * })
  * ```
  * @default []
  */
  exclude?: StringOrRegExp | StringOrRegExp[];
  /**
  * An optional function that will be called immediately every time
  * a module changes that is part of the build.
  *
  * This is different from the {@linkcode Plugin.watchChange | watchChange} plugin hook, which is
  * only called once the running build has finished. This may for
  * instance be used to prevent additional steps from being performed
  * if we know another build will be started anyway once the current
  * build finished. This callback may be called multiple times per
  * build as it tracks every change.
  *
  * @param id The id of the changed module.
  */
  onInvalidate?: (id: string) => void;
  /**
  * Whether to clear the screen when a rebuild is triggered.
  * @default true
  */
  clearScreen?: boolean;
}
/** @inline */
type MakeAbsoluteExternalsRelative = boolean | "ifRelativeSource";
type DevModeOptions = boolean | {
  host?: string;
  port?: number;
  implement?: string;
  lazy?: boolean;
};
type OptimizationOptions = {
  /**
  * Inline imported constant values during bundling instead of preserving variable references.
  *
  * When enabled, constant values from imported modules will be inlined at their usage sites,
  * potentially reducing bundle size and improving runtime performance by eliminating variable lookups.
  *
  * **Options:**
  * - `true`: equivalent to `{ mode: 'all', pass: 1 }`, enabling constant inlining for all eligible constants with a single pass.
  * - `false`: Disable constant inlining
  * - `{ mode: 'smart' | 'all', pass?: number }`:
  *   - `mode: 'smart'`: Only inline constants in specific scenarios where it is likely to reduce bundle size and improve performance.
  *     Smart mode inlines constants in these specific scenarios:
  *     1. `if (test) {} else {}` - condition expressions in if statements
  *     2. `test ? a : b` - condition expressions in ternary operators
  *     3. `test1 || test2` - logical OR expressions
  *     4. `test1 && test2` - logical AND expressions
  *     5. `test1 ?? test2` - nullish coalescing expressions
  *  - `mode: 'all'`: Inline all imported constants wherever they are used.
  *  - `pass`: Number of passes to perform for inlining constants.
  *
  * @example
  * ```js
  * // Input files:
  * // constants.js
  * export const API_URL = 'https://api.example.com';
  *
  * // main.js
  * import { API_URL } from './constants.js';
  * console.log(API_URL);
  *
  * // With inlineConst: true, the bundled output becomes:
  * console.log('https://api.example.com');
  *
  * // Instead of:
  * const API_URL = 'https://api.example.com';
  * console.log(API_URL);
  * ```
  *
  * @default false
  */
  inlineConst?: boolean | {
    mode?: "all" | "smart";
    pass?: number;
  };
  /**
  * Use PIFE pattern for module wrappers.
  *
  * Enabling this option improves the start up performance of the generated bundle with the cost of a slight increase in bundle size.
  *
  *
  *
  * @default true
  */
  pifeForModuleWrappers?: boolean;
};
/** @inline */
type AttachDebugOptions = "none" | "simple" | "full";
/** @inline */
type ChunkModulesOrder = "exec-order" | "module-id";
/** @inline */
type OnLogFunction = (level: LogLevel$1, log: RolldownLog, defaultHandler: LogOrStringHandler) => void;
/** @inline */
type OnwarnFunction = (warning: RolldownLog, defaultHandler: (warning: RolldownLogWithString | (() => RolldownLogWithString)) => void) => void;
interface InputOptions {
  /**
  * Defines entries and location(s) of entry modules for the bundle. Relative paths are resolved based on the {@linkcode cwd} option.
  *
  */
  input?: InputOption;
  /**
  * The list of plugins to use.
  *
  * Falsy plugins will be ignored, which can be used to easily activate or deactivate plugins. Nested plugins will be flattened. Async plugins will be awaited and resolved.
  *
  * See [Plugin API document](https://rolldown.rs/apis/plugin-api) for more details about creating plugins.
  *
  * @example
  * ```js
  * import { defineConfig } from 'rolldown'
  *
  * export default defineConfig({
  *   plugins: [
  *     examplePlugin1(),
  *     // Conditional plugins
  *     process.env.ENV1 && examplePlugin2(),
  *     // Nested plugins arrays are flattened
  *     [examplePlugin3(), examplePlugin4()],
  *   ]
  * })
  * ```
  */
  plugins?: RolldownPluginOption;
  /**
  * Specifies which modules should be treated as external and not bundled. External modules will be left as import statements in the output.
  *
  */
  external?: ExternalOption;
  /**
  * Options for built-in module resolution feature.
  */
  resolve?: {
    /**
    * Substitute one package for another.
    *
    * One use case for this feature is replacing a node-only package with a browser-friendly package in third-party code that you don't control.
    *
    * @example
    * ```js
    * resolve: {
    *   alias: {
    *     '@': '/src',
    *     'utils': './src/utils',
    *   }
    * }
    * ```
    * > [!WARNING]
    * > `resolve.alias` will not call [`resolveId`](/reference/Interface.Plugin#resolveid) hooks of other plugin.
    * > If you want to call `resolveId` hooks of other plugin, use `viteAliasPlugin` from `rolldown/experimental` instead.
    * > You could find more discussion in [this issue](https://github.com/rolldown/rolldown/issues/3615)
    */
    alias?: Record<string, string[] | string | false>;
    /**
    * Fields in package.json to check for aliased paths.
    *
    * This option is expected to be used for `browser` field support.
    *
    * @default
    * - `[['browser']]` for `browser` platform
    * - `[]` for other platforms
    */
    aliasFields?: string[][];
    /**
    * Condition names to use when resolving exports in package.json.
    *
    * @default
    * Defaults based on platform and import kind:
    * - `browser` platform
    *   - `["import", "browser", "default"]` for import statements
    *   - `["require", "browser", "default"]` for require() calls
    * - `node` platform
    *   - `["import", "node", "default"]` for import statements
    *   - `["require", "node", "default"]` for require() calls
    * - `neutral` platform
    *   - `["import", "default"]` for import statements
    *   - `["require", "default"]` for require() calls
    */
    conditionNames?: string[];
    /**
    * Map of extensions to alternative extensions.
    *
    * With writing `import './foo.js'` in a file, you want to resolve it to `foo.ts` instead of `foo.js`.
    * You can achieve this by setting: `extensionAlias: { '.js': ['.ts', '.js'] }`.
    */
    extensionAlias?: Record<string, string[]>;
    /**
    * Fields in package.json to check for exports.
    *
    * @default `[['exports']]`
    */
    exportsFields?: string[][];
    /**
    * Extensions to try when resolving files. These are tried in order from first to last.
    *
    * @default `['.tsx', '.ts', '.jsx', '.js', '.json']`
    */
    extensions?: string[];
    /**
    * Fields in package.json to check for entry points.
    *
    * @default
    * Defaults based on platform:
    * - `node` platform: `['main', 'module']`
    * - `browser` platform: `['browser', 'module', 'main']`
    * - `neutral` platform: `[]`
    */
    mainFields?: string[];
    /**
    * Filenames to try when resolving directories.
    * @default ['index']
    */
    mainFiles?: string[];
    /**
    * Directories to search for modules.
    * @default ['node_modules']
    */
    modules?: string[];
    /**
    * Whether to follow symlinks when resolving modules.
    * @default true
    */
    symlinks?: boolean;
    /**
    * @deprecated Use the top-level {@linkcode tsconfig} option instead.
    */
    tsconfigFilename?: string;
  };
  /**
  * The working directory to use when resolving relative paths in the configuration.
  * @default process.cwd()
  */
  cwd?: string;
  /**
  * Expected platform where the code run.
  *
  *  When the platform is set to neutral:
  *    - When bundling is enabled the default output format is set to esm, which uses the export syntax introduced with ECMAScript 2015 (i.e. ES6). You can change the output format if this default is not appropriate.
  *    - The main fields setting is empty by default. If you want to use npm-style packages, you will likely have to configure this to be something else such as main for the standard main field used by node.
  *    - The conditions setting does not automatically include any platform-specific values.
  *
  * @default
  * - `'node'` if the format is `'cjs'`
  * - `'browser'` for other formats
  *
  */
  platform?: "node" | "browser" | "neutral";
  /**
  * When `true`, creates shim variables for missing exports instead of throwing an error.
  * @default false
  *
  */
  shimMissingExports?: boolean;
  /**
  * Controls tree-shaking (dead code elimination).
  *
  * See the [In-depth Dead Code Elimination Guide](https://rolldown.rs/in-depth/dead-code-elimination) for more details.
  *
  * When `false`, tree-shaking will be disabled.
  * When `true`, it is equivalent to setting each options to the default value.
  *
  * @default true
  */
  treeshake?: boolean | TreeshakingOptions;
  /**
  * Controls the verbosity of console logging during the build.
  *
  *
  *
  * @default 'info'
  */
  logLevel?: LogLevelOption;
  /**
  * A function that intercepts log messages. If not supplied, logs are printed to the console.
  *
  *
  *
  * @example
  * ```js
  * export default defineConfig({
  *   onLog(level, log, defaultHandler) {
  *     if (log.code === 'CIRCULAR_DEPENDENCY') {
  *       return; // Ignore circular dependency warnings
  *     }
  *     if (level === 'warn') {
  *       defaultHandler('error', log); // turn other warnings into errors
  *     } else {
  *       defaultHandler(level, log); // otherwise, just print the log
  *     }
  *   }
  * })
  * ```
  */
  onLog?: OnLogFunction;
  /**
  * A function that will intercept warning messages.
  *
  *
  *
  * @deprecated
  * This is a legacy API. Consider using {@linkcode onLog} instead for better control over all log types.
  *
  *
  */
  onwarn?: OnwarnFunction;
  /**
  * Maps file patterns to module types, controlling how files are processed.
  *
  * This is conceptually similar to [esbuild's `loader`](https://esbuild.github.io/api/#loader) option, allowing you to specify how each file extensions should be handled.
  *
  * See [the In-Depth Guide](https://rolldown.rs/in-depth/module-types) for more details.
  *
  * @example
  * ```js
  * import { defineConfig } from 'rolldown'
  *
  * export default defineConfig({
  *   moduleTypes: {
  *     '.frag': 'text',
  *   }
  * })
  * ```
  */
  moduleTypes?: ModuleTypes;
  /**
  * Experimental features that may change in future releases and can introduce behavior change without a major version bump.
  * @experimental
  */
  experimental?: {
    /**
    * Enable Vite compatible mode.
    * @default false
    * @hidden This option is only meant to be used by Vite. It is not recommended to use this option directly.
    */
    viteMode?: boolean;
    /**
    * When enabled, `new URL()` calls will be transformed to a stable asset URL which includes the updated name and content hash.
    * It is necessary to pass `import.meta.url` as the second argument to the
    * `new URL` constructor, otherwise no transform will be applied.
    * :::warning
    * JavaScript and TypeScript files referenced via `new URL('./file.js', import.meta.url)` or `new URL('./file.ts', import.meta.url)` will **not** be transformed or bundled. The file will be copied as-is, meaning TypeScript files remain untransformed and dependencies are not resolved.
    *
    * The expected behavior for JS/TS files is still being discussed and may
    * change in future releases. See [#7258](https://github.com/rolldown/rolldown/issues/7258) for more context.
    * :::
    * @example
    * ```js
    * // main.js
    * const url = new URL('./styles.css', import.meta.url);
    * console.log(url);
    *
    * // Example output after bundling WITHOUT the option (default)
    * const url = new URL('./styles.css', import.meta.url);
    * console.log(url);
    *
    * // Example output after bundling WITH `experimental.resolveNewUrlToAsset` set to `true`
    * const url = new URL('assets/styles-CjdrdY7X.css', import.meta.url);
    * console.log(url);
    * ```
    * @default false
    */
    resolveNewUrlToAsset?: boolean;
    /**
    * Dev mode related options.
    * @hidden not ready for public usage yet
    */
    devMode?: DevModeOptions;
    /**
    * Control which order should be used when rendering modules in a chunk.
    *
    * Available options:
    * - `exec-order`: Almost equivalent to the topological order of the module graph, but specially handling when module graph has cycle.
    * - `module-id`: This is more friendly for gzip compression, especially for some javascript static asset lib (e.g. icon library)
    *
    * > [!NOTE]
    * > Try to sort the modules by their module id if possible (Since rolldown scope hoist all modules in the chunk, we only try to sort those modules by module id if we could ensure runtime behavior is correct after sorting).
    *
    * @default 'exec-order'
    */
    chunkModulesOrder?: ChunkModulesOrder;
    /**
    * Attach debug information to the output bundle.
    *
    * Available modes:
    * - `none`: No debug information is attached.
    * - `simple`: Attach comments indicating which files the bundled code comes from. These comments could be removed by the minifier.
    * - `full`: Attach detailed debug information to the output bundle. These comments are using legal comment syntax, so they won't be removed by the minifier.
    *
    * @default 'simple'
    *
    *
    */
    attachDebugInfo?: AttachDebugOptions;
    /**
    * Enables automatic generation of a chunk import map asset during build.
    *
    * This map only includes chunks with hashed filenames, where keys are derived from the facade module
    * name or primary chunk name. It produces stable and unique hash-based filenames, effectively preventing
    * cascading cache invalidation caused by content hashes and maximizing browser cache reuse.
    *
    * The output defaults to `importmap.json` unless overridden via `fileName`. A base URL prefix
    * (default `"/"`) can be applied to all paths. The resulting JSON is a valid import map and can be
    * directly injected into HTML via `<script type="importmap">`.
    *
    * @example
    * ```js
    * {
    *   experimental: {
    *     chunkImportMap: {
    *       baseUrl: '/',
    *       fileName: 'importmap.json'
    *     }
    *   },
    *   plugins: [
    *     {
    *       name: 'inject-import-map',
    *       generateBundle(_, bundle) {
    *         const chunkImportMap = bundle['importmap.json'];
    *         if (chunkImportMap?.type === 'asset') {
    *           const htmlPath = path.resolve('index.html');
    *           let html = fs.readFileSync(htmlPath, 'utf-8');
    *
    *           html = html.replace(
    *             /<script\s+type="importmap"[^>]*>[\s\S]*?<\/script>/i,
    *             `<script type="importmap">${chunkImportMap.source}<\/script>`
    *           );
    *
    *           fs.writeFileSync(htmlPath, html);
    *           delete bundle['importmap.json'];
    *         }
    *       }
    *     }
    *   ]
    * }
    * ```
    *
    * > [!TIP]
    * > If you want to learn more, you can check out the example here: [examples/chunk-import-map](https://github.com/rolldown/rolldown/tree/main/examples/chunk-import-map)
    *
    * @default false
    */
    chunkImportMap?: boolean | {
      baseUrl?: string;
      fileName?: string;
    };
    /**
    * Enable on-demand wrapping of modules.
    * @default false
    * @hidden not ready for public usage yet
    */
    onDemandWrapping?: boolean;
    /**
    * Enable incremental build support. Required to be used with `watch` mode.
    * @default false
    */
    incrementalBuild?: boolean;
    /**
    * Use native Rust implementation of MagicString for source map generation.
    *
    * [MagicString](https://github.com/rich-harris/magic-string) is a JavaScript library commonly used by bundlers
    * for string manipulation and source map generation. When enabled, rolldown will use a native Rust
    * implementation of MagicString instead of the JavaScript version, providing significantly better performance
    * during source map generation and code transformation.
    *
    * **Benefits**
    *
    * - **Improved Performance**: The native Rust implementation is typically faster than the JavaScript version,
    *   especially for large codebases with extensive source maps.
    * - **Background Processing**: Source map generation is performed asynchronously in a background thread,
    *   allowing the main bundling process to continue without blocking. This parallel processing can significantly
    *   reduce overall build times when working with JavaScript transform hooks.
    * - **Better Integration**: Seamless integration with rolldown's native Rust architecture.
    *
    * @example
    * ```js
    * export default {
    *   experimental: {
    *     nativeMagicString: true
    *   },
    *   output: {
    *     sourcemap: true
    *   }
    * }
    * ```
    *
    * > [!NOTE]
    * > This is an experimental feature. While it aims to provide identical behavior to the JavaScript
    * > implementation, there may be edge cases. Please report any discrepancies you encounter.
    * > For a complete working example, see [examples/native-magic-string](https://github.com/rolldown/rolldown/tree/main/examples/native-magic-string)
    * @default false
    */
    nativeMagicString?: boolean;
    /**
    * Control whether to optimize chunks by allowing entry chunks to have different exports than the underlying entry module.
    * This optimization can reduce the number of generated chunks.
    *
    * When enabled, rolldown will try to insert common modules directly into existing chunks rather than creating
    * separate chunks for them, which can result in fewer output files and better performance.
    *
    * This optimization is automatically disabled when any module uses top-level await (TLA) or contains TLA dependencies,
    * as it could affect execution order guarantees.
    *
    * @default true
    */
    chunkOptimization?: boolean;
    /**
    * Control whether to enable lazy barrel optimization.
    *
    * Lazy barrel optimization avoids compiling unused re-export modules in side-effect-free barrel modules,
    * significantly improving build performance for large codebases with many barrel modules.
    *
    * @see {@link https://rolldown.rs/in-depth/lazy-barrel-optimization | Lazy Barrel Documentation}
    * @default false
    */
    lazyBarrel?: boolean;
  };
  /**
  * Configure how the code is transformed. This process happens after the `transform` hook.
  *
  * @example
  * **Enable legacy decorators**
  * ```js
  * export default defineConfig({
  *   transform: {
  *     decorator: {
  *       legacy: true,
  *     },
  *   },
  * })
  * ```
  * Note that if you have correct `tsconfig.json` file, Rolldown will automatically detect and enable legacy decorators support.
  *
  *
  */
  transform?: TransformOptions$1;
  /**
  * Watch mode related options.
  *
  * These options only take effect when running with the [`--watch`](/apis/cli#w-watch) flag, or using {@linkcode watch | watch()} API.
  *
  * @experimental
  */
  watch?: WatcherOptions | false;
  /**
  * Controls which warnings are emitted during the build process. Each option can be set to `true` (emit warning) or `false` (suppress warning).
  */
  checks?: ChecksOptions;
  /**
  * Determines if absolute external paths should be converted to relative paths in the output.
  *
  * This does not only apply to paths that are absolute in the source but also to paths that are resolved to an absolute path by either a plugin or Rolldown core.
  *
  *
  */
  makeAbsoluteExternalsRelative?: MakeAbsoluteExternalsRelative;
  /**
  * Devtools integration options.
  * @experimental
  */
  devtools?: {
    sessionId?: string;
  };
  /**
  * Controls how entry chunk exports are preserved.
  *
  * This determines whether Rolldown needs to create facade chunks (additional wrapper chunks) to maintain the exact export signatures of entry modules, or whether it can combine entry modules with other chunks for optimization.
  *
  * @default `'exports-only'`
  *
  */
  preserveEntrySignatures?: false | "strict" | "allow-extension" | "exports-only";
  /**
  * Configure optimization features for the bundler.
  */
  optimization?: OptimizationOptions;
  /**
  * The value of `this` at the top level of each module. **Normally, you don't need to set this option.**
  * @default undefined
  * @example
  * **Set custom context**
  * ```js
  * export default {
  *   context: 'globalThis',
  *   output: {
  *     format: 'iife',
  *   },
  * };
  * ```
  *
  */
  context?: string;
  /**
  * Configures TypeScript configuration file resolution and usage.
  *
  * @default true
  */
  tsconfig?: boolean | string;
} //#endregion
//#region src/types/rolldown-options.d.ts
//#endregion
//#region ../../node_modules/.pnpm/nitro@3.0.1-alpha.2_ioredis@5.9.1_rolldown@1.0.0-rc.3_rollup@4.57.1_vite@7.3.1_@types+n_bc95901b35857ac86ce0ed75e4a2aaa2/node_modules/nitro/dist/_libs/pluginutils+plugin-commonjs.d.mts
//#region node_modules/.pnpm/@rollup+pluginutils@5.3.0_rollup@4.55.3/node_modules/@rollup/pluginutils/types/index.d.ts
/**
 * A valid `picomatch` glob pattern, or array of patterns.
 */
type FilterPattern$1 = ReadonlyArray<string | RegExp> | string | RegExp | null; //#endregion
//#region node_modules/.pnpm/@rollup+plugin-commonjs@29.0.0_rollup@4.55.3/node_modules/@rollup/plugin-commonjs/types/index.d.ts
type RequireReturnsDefaultOption = boolean | 'auto' | 'preferred' | 'namespace';
type DefaultIsModuleExportsOption = boolean | 'auto';
interface RollupCommonJSOptions$1 {
  /**
   * A picomatch pattern, or array of patterns, which specifies the files in
   * the build the plugin should operate on. By default, all files with
   * extension `".cjs"` or those in `extensions` are included, but you can
   * narrow this list by only including specific files. These files will be
   * analyzed and transpiled if either the analysis does not find ES module
   * specific statements or `transformMixedEsModules` is `true`.
   * @default undefined
   */
  include?: FilterPattern$1;
  /**
   * A picomatch pattern, or array of patterns, which specifies the files in
   * the build the plugin should _ignore_. By default, all files with
   * extensions other than those in `extensions` or `".cjs"` are ignored, but you
   * can exclude additional files. See also the `include` option.
   * @default undefined
   */
  exclude?: FilterPattern$1;
  /**
   * For extensionless imports, search for extensions other than .js in the
   * order specified. Note that you need to make sure that non-JavaScript files
   * are transpiled by another plugin first.
   * @default [ '.js' ]
   */
  extensions?: ReadonlyArray<string>;
  /**
   * If true then uses of `global` won't be dealt with by this plugin
   * @default false
   */
  ignoreGlobal?: boolean;
  /**
   * If false, skips source map generation for CommonJS modules. This will
   * improve performance.
   * @default true
   */
  sourceMap?: boolean;
  /**
   * Some `require` calls cannot be resolved statically to be translated to
   * imports.
   * When this option is set to `false`, the generated code will either
   * directly throw an error when such a call is encountered or, when
   * `dynamicRequireTargets` is used, when such a call cannot be resolved with a
   * configured dynamic require target.
   * Setting this option to `true` will instead leave the `require` call in the
   * code or use it as a fallback for `dynamicRequireTargets`.
   * @default false
   */
  ignoreDynamicRequires?: boolean;
  /**
   * Instructs the plugin whether to enable mixed module transformations. This
   * is useful in scenarios with modules that contain a mix of ES `import`
   * statements and CommonJS `require` expressions. Set to `true` if `require`
   * calls should be transformed to imports in mixed modules, or `false` if the
   * `require` expressions should survive the transformation. The latter can be
   * important if the code contains environment detection, or you are coding
   * for an environment with special treatment for `require` calls such as
   * ElectronJS. See also the `ignore` option.
   * @default false
   */
  transformMixedEsModules?: boolean;
  /**
   * By default, this plugin will try to hoist `require` statements as imports
   * to the top of each file. While this works well for many code bases and
   * allows for very efficient ESM output, it does not perfectly capture
   * CommonJS semantics as the order of side effects like log statements may
   * change. But it is especially problematic when there are circular `require`
   * calls between CommonJS modules as those often rely on the lazy execution of
   * nested `require` calls.
   *
   * Setting this option to `true` will wrap all CommonJS files in functions
   * which are executed when they are required for the first time, preserving
   * NodeJS semantics. Note that this can have an impact on the size and
   * performance of the generated code.
   *
   * The default value of `"auto"` will only wrap CommonJS files when they are
   * part of a CommonJS dependency cycle, e.g. an index file that is required by
   * many of its dependencies. All other CommonJS files are hoisted. This is the
   * recommended setting for most code bases.
   *
   * `false` will entirely prevent wrapping and hoist all files. This may still
   * work depending on the nature of cyclic dependencies but will often cause
   * problems.
   *
   * You can also provide a picomatch pattern, or array of patterns, to only
   * specify a subset of files which should be wrapped in functions for proper
   * `require` semantics.
   *
   * `"debug"` works like `"auto"` but after bundling, it will display a warning
   * containing a list of ids that have been wrapped which can be used as
   * picomatch pattern for fine-tuning.
   * @default "auto"
   */
  strictRequires?: boolean | FilterPattern$1;
  /**
   * Sometimes you have to leave require statements unconverted. Pass an array
   * containing the IDs or a `id => boolean` function.
   * @default []
   */
  ignore?: ReadonlyArray<string> | ((id: string) => boolean);
  /**
   * In most cases, where `require` calls are inside a `try-catch` clause,
   * they should be left unconverted as it requires an optional dependency
   * that may or may not be installed beside the rolled up package.
   * Due to the conversion of `require` to a static `import` - the call is
   * hoisted to the top of the file, outside the `try-catch` clause.
   *
   * - `true`: Default. All `require` calls inside a `try` will be left unconverted.
   * - `false`: All `require` calls inside a `try` will be converted as if the
   *   `try-catch` clause is not there.
   * - `remove`: Remove all `require` calls from inside any `try` block.
   * - `string[]`: Pass an array containing the IDs to left unconverted.
   * - `((id: string) => boolean|'remove')`: Pass a function that controls
   *   individual IDs.
   *
   * @default true
   */
  ignoreTryCatch?: boolean | 'remove' | ReadonlyArray<string> | ((id: string) => boolean | 'remove');
  /**
   * Controls how to render imports from external dependencies. By default,
   * this plugin assumes that all external dependencies are CommonJS. This
   * means they are rendered as default imports to be compatible with e.g.
   * NodeJS where ES modules can only import a default export from a CommonJS
   * dependency.
   *
   * If you set `esmExternals` to `true`, this plugin assumes that all
   * external dependencies are ES modules and respect the
   * `requireReturnsDefault` option. If that option is not set, they will be
   * rendered as namespace imports.
   *
   * You can also supply an array of ids to be treated as ES modules, or a
   * function that will be passed each external id to determine whether it is
   * an ES module.
   * @default false
   */
  esmExternals?: boolean | ReadonlyArray<string> | ((id: string) => boolean);
  /**
   * Controls what is returned when requiring an ES module from a CommonJS file.
   * When using the `esmExternals` option, this will also apply to external
   * modules. By default, this plugin will render those imports as namespace
   * imports i.e.
   *
   * ```js
   * // input
   * const foo = require('foo');
   *
   * // output
   * import * as foo from 'foo';
   * ```
   *
   * However, there are some situations where this may not be desired.
   * For these situations, you can change Rollup's behaviour either globally or
   * per module. To change it globally, set the `requireReturnsDefault` option
   * to one of the following values:
   *
   * - `false`: This is the default, requiring an ES module returns its
   *   namespace. This is the only option that will also add a marker
   *   `__esModule: true` to the namespace to support interop patterns in
   *   CommonJS modules that are transpiled ES modules.
   * - `"namespace"`: Like `false`, requiring an ES module returns its
   *   namespace, but the plugin does not add the `__esModule` marker and thus
   *   creates more efficient code. For external dependencies when using
   *   `esmExternals: true`, no additional interop code is generated.
   * - `"auto"`: This is complementary to how `output.exports: "auto"` works in
   *   Rollup: If a module has a default export and no named exports, requiring
   *   that module returns the default export. In all other cases, the namespace
   *   is returned. For external dependencies when using `esmExternals: true`, a
   *   corresponding interop helper is added.
   * - `"preferred"`: If a module has a default export, requiring that module
   *   always returns the default export, no matter whether additional named
   *   exports exist. This is similar to how previous versions of this plugin
   *   worked. Again for external dependencies when using `esmExternals: true`,
   *   an interop helper is added.
   * - `true`: This will always try to return the default export on require
   *   without checking if it actually exists. This can throw at build time if
   *   there is no default export. This is how external dependencies are handled
   *   when `esmExternals` is not used. The advantage over the other options is
   *   that, like `false`, this does not add an interop helper for external
   *   dependencies, keeping the code lean.
   *
   * To change this for individual modules, you can supply a function for
   * `requireReturnsDefault` instead. This function will then be called once for
   * each required ES module or external dependency with the corresponding id
   * and allows you to return different values for different modules.
   * @default false
   */
  requireReturnsDefault?: RequireReturnsDefaultOption | ((id: string) => RequireReturnsDefaultOption);
  /**
   * @default "auto"
   */
  defaultIsModuleExports?: DefaultIsModuleExportsOption | ((id: string) => DefaultIsModuleExportsOption);
  /**
   * Some modules contain dynamic `require` calls, or require modules that
   * contain circular dependencies, which are not handled well by static
   * imports. Including those modules as `dynamicRequireTargets` will simulate a
   * CommonJS (NodeJS-like) environment for them with support for dynamic
   * dependencies. It also enables `strictRequires` for those modules.
   *
   * Note: In extreme cases, this feature may result in some paths being
   * rendered as absolute in the final bundle. The plugin tries to avoid
   * exposing paths from the local machine, but if you are `dynamicRequirePaths`
   * with paths that are far away from your project's folder, that may require
   * replacing strings like `"/Users/John/Desktop/foo-project/"` -> `"/"`.
   */
  dynamicRequireTargets?: string | ReadonlyArray<string>;
  /**
   * To avoid long paths when using the `dynamicRequireTargets` option, you can use this option to specify a directory
   * that is a common parent for all files that use dynamic require statements. Using a directory higher up such as `/`
   * may lead to unnecessarily long paths in the generated code and may expose directory names on your machine like your
   * home directory name. By default, it uses the current working directory.
   */
  dynamicRequireRoot?: string;
  /**
   * When enabled, external Node built-ins (e.g., `node:fs`) required from wrapped CommonJS modules
   * will use `createRequire(import.meta.url)` instead of being hoisted as ESM imports. This prevents
   * eager loading of Node built-ins at module initialization time.
   *
   * Note: This option adds a dependency on `node:module` in the output, which may not be available
   * in some environments like edge runtimes (Cloudflare Workers, Vercel Edge Runtime).
   *
   * @default false
   */
  requireNodeBuiltins?: boolean;
}
/**
 * Convert CommonJS modules to ES6, so they can be included in a Rollup bundle
 */
declare function commonjs(options?: RollupCommonJSOptions$1): Plugin$2; //#endregion
//#endregion
//#region ../../node_modules/.pnpm/nitro@3.0.1-alpha.2_ioredis@5.9.1_rolldown@1.0.0-rc.3_rollup@4.57.1_vite@7.3.1_@types+n_bc95901b35857ac86ce0ed75e4a2aaa2/node_modules/nitro/dist/_libs/c12+giget+readdirp+chokidar.d.mts
//#region node_modules/.pnpm/chokidar@5.0.0/node_modules/chokidar/index.d.ts
type AWF = {
  stabilityThreshold: number;
  pollInterval: number;
};
type BasicOpts = {
  persistent: boolean;
  ignoreInitial: boolean;
  followSymlinks: boolean;
  cwd?: string;
  usePolling: boolean;
  interval: number;
  binaryInterval: number;
  alwaysStat?: boolean;
  depth?: number;
  ignorePermissionErrors: boolean;
  atomic: boolean | number;
};
type ChokidarOptions = Partial<BasicOpts & {
  ignored: Matcher | Matcher[];
  awaitWriteFinish: boolean | Partial<AWF>;
}>;
type MatchFunction = (val: string, stats?: Stats) => boolean;
interface MatcherObject {
  path: string;
  recursive?: boolean;
}
type Matcher = string | RegExp | MatchFunction | MatcherObject; //#endregion
//#region node_modules/.pnpm/giget@2.0.0/node_modules/giget/dist/index.d.mts
interface TemplateInfo {
  name: string;
  tar: string;
  version?: string;
  subdir?: string;
  url?: string;
  defaultDir?: string;
  headers?: Record<string, string | undefined>;
  source?: never;
  dir?: never;
  [key: string]: any;
}
type TemplateProvider = (input: string, options: {
  auth?: string;
}) => TemplateInfo | Promise<TemplateInfo> | null;
interface DownloadTemplateOptions {
  provider?: string;
  force?: boolean;
  forceClean?: boolean;
  offline?: boolean;
  preferOffline?: boolean;
  providers?: Record<string, TemplateProvider>;
  dir?: string;
  registry?: false | string;
  cwd?: string;
  auth?: string;
  install?: boolean;
  silent?: boolean;
} //#endregion
//#region node_modules/.pnpm/c12@3.3.3_magicast@0.5.1/node_modules/c12/dist/index.d.mts
//#region src/dotenv.d.ts
declare global {
  var __c12_dotenv_vars__: Map<Record<string, any>, Set<string>>;
} //#endregion
//#region src/types.d.ts
interface ConfigLayerMeta {
  name?: string;
  [key: string]: any;
}
type UserInputConfig = Record<string, any>;
interface C12InputConfig<T extends UserInputConfig = UserInputConfig, MT extends ConfigLayerMeta = ConfigLayerMeta> {
  $test?: T;
  $development?: T;
  $production?: T;
  $env?: Record<string, T>;
  $meta?: MT;
}
interface SourceOptions<T extends UserInputConfig = UserInputConfig, MT extends ConfigLayerMeta = ConfigLayerMeta> {
  /** Custom meta for layer */
  meta?: MT;
  /** Layer config overrides */
  overrides?: T;
  [key: string]: any;
  /**
   * Options for cloning remote sources
   *
   * @see https://giget.unjs.io
   */
  giget?: DownloadTemplateOptions;
  /**
   * Install dependencies after cloning
   *
   * @see https://nypm.unjs.io
   */
  install?: boolean;
  /**
   * Token for cloning private sources
   *
   * @see https://giget.unjs.io#providing-token-for-private-repositories
   */
  auth?: string;
}
interface ConfigLayer<T extends UserInputConfig = UserInputConfig, MT extends ConfigLayerMeta = ConfigLayerMeta> {
  config: T | null;
  source?: string;
  sourceOptions?: SourceOptions<T, MT>;
  meta?: MT;
  cwd?: string;
  configFile?: string;
}
interface ResolvedConfig<T extends UserInputConfig = UserInputConfig, MT extends ConfigLayerMeta = ConfigLayerMeta> extends ConfigLayer<T, MT> {
  config: T;
  layers?: ConfigLayer<T, MT>[];
  cwd?: string;
  _configFile?: string;
}
type ConfigWatcher<T extends UserInputConfig = UserInputConfig, MT extends ConfigLayerMeta = ConfigLayerMeta> = ResolvedConfig<T, MT> & {
  watchingFiles: string[];
  unwatch: () => Promise<void>;
};
//#endregion
//#region ../../node_modules/.pnpm/nitro@3.0.1-alpha.2_ioredis@5.9.1_rolldown@1.0.0-rc.3_rollup@4.57.1_vite@7.3.1_@types+n_bc95901b35857ac86ce0ed75e4a2aaa2/node_modules/nitro/dist/_libs/compatx.d.mts
//#region node_modules/.pnpm/compatx@0.2.0/node_modules/compatx/dist/index.d.mts
/**
 * Known platform names
 */
declare const platforms: readonly ["aws", "azure", "cloudflare", "deno", "firebase", "netlify", "vercel"];
/**
 * Known platform name
 */
type PlatformName = (typeof platforms)[number] | (string & {});
/**
 * Normalize the compatibility dates from input config and defaults.
 */
type Year = `${number}${number}${number}${number}`;
type Month = `${"0" | "1"}${number}`;
type Day = `${"0" | "1" | "2" | "3"}${number}`;
/**
 * Typed date string in `YYYY-MM-DD` format
 *
 * Empty string is used to represent an "unspecified" date.
 *
 * "latest" is used to represent the latest date available (date of today).
 */
type DateString = "" | "latest" | `${Year}-${Month}-${Day}`;
/**
 * Last known compatibility dates for platforms
 *
 * @example
 * {
 *  "default": "2024-01-01",
 *  "cloudflare": "2024-03-01",
 * }
 */
type CompatibilityDates = {
  /**
   * Default compatibility date for all unspecified platforms (required)
   */
  default: DateString;
} & Partial<Record<PlatformName, DateString>>;
/**
 * Last known compatibility date for the used platform
 */
type CompatibilityDateSpec = DateString | Partial<CompatibilityDates>;
/**
 * Get compatibility updates applicable for the user given platform and date range.
 */
//#endregion
//#endregion
//#region ../../node_modules/.pnpm/nitro@3.0.1-alpha.2_ioredis@5.9.1_rolldown@1.0.0-rc.3_rollup@4.57.1_vite@7.3.1_@types+n_bc95901b35857ac86ce0ed75e4a2aaa2/node_modules/nitro/dist/_libs/httpxy.d.mts
//#region node_modules/.pnpm/httpxy@0.1.7/node_modules/httpxy/dist/index.d.ts
interface ProxyTargetDetailed {
  host: string;
  port: number;
  protocol?: string;
  hostname?: string;
  socketPath?: string;
  key?: string;
  passphrase?: string;
  pfx?: Buffer | string;
  cert?: string;
  ca?: string;
  ciphers?: string;
  secureProtocol?: string;
}
type ProxyTarget = ProxyTargetUrl | ProxyTargetDetailed;
type ProxyTargetUrl = string | Partial<URL>;
interface ProxyServerOptions {
  /** URL string to be parsed with the url module. */
  target?: ProxyTarget;
  /** URL string to be parsed with the url module. */
  forward?: ProxyTargetUrl;
  /** Object to be passed to http(s).request. */
  agent?: any;
  /** Object to be passed to https.createServer(). */
  ssl?: any;
  /** If you want to proxy websockets. */
  ws?: boolean;
  /** Adds x- forward headers. */
  xfwd?: boolean;
  /** Verify SSL certificate. */
  secure?: boolean;
  /** Explicitly specify if we are proxying to another proxy. */
  toProxy?: boolean;
  /** Specify whether you want to prepend the target's path to the proxy path. */
  prependPath?: boolean;
  /** Specify whether you want to ignore the proxy path of the incoming request. */
  ignorePath?: boolean;
  /** Local interface string to bind for outgoing connections. */
  localAddress?: string;
  /** Changes the origin of the host header to the target URL. */
  changeOrigin?: boolean;
  /** specify whether you want to keep letter case of response header key */
  preserveHeaderKeyCase?: boolean;
  /** Basic authentication i.e. 'user:password' to compute an Authorization header. */
  auth?: string;
  /** Rewrites the location hostname on (301 / 302 / 307 / 308) redirects, Default: null. */
  hostRewrite?: string;
  /** Rewrites the location host/ port on (301 / 302 / 307 / 308) redirects based on requested host/ port.Default: false. */
  autoRewrite?: boolean;
  /** Rewrites the location protocol on (301 / 302 / 307 / 308) redirects to 'http' or 'https'.Default: null. */
  protocolRewrite?: string;
  /** Rewrites domain of set-cookie headers. */
  cookieDomainRewrite?: false | string | {
    [oldDomain: string]: string;
  };
  /** Rewrites path of set-cookie headers. Default: false */
  cookiePathRewrite?: false | string | {
    [oldPath: string]: string;
  };
  /** Object with extra headers to be added to target requests. */
  headers?: {
    [header: string]: string;
  };
  /** Timeout (in milliseconds) when proxy receives no response from target. Default: 120000 (2 minutes) */
  proxyTimeout?: number;
  /** Timeout (in milliseconds) for incoming requests */
  timeout?: number;
  /** If set to true, none of the webOutgoing passes are called and it's your responsibility to appropriately return the response by listening and acting on the proxyRes event */
  selfHandleResponse?: boolean;
  /** Buffer */
  buffer?: stream.Stream;
} //#endregion
//#endregion
//#region ../../node_modules/.pnpm/nitro@3.0.1-alpha.2_ioredis@5.9.1_rolldown@1.0.0-rc.3_rollup@4.57.1_vite@7.3.1_@types+n_bc95901b35857ac86ce0ed75e4a2aaa2/node_modules/nitro/dist/_libs/pkg-types.d.mts
//#region node_modules/.pnpm/pkg-types@2.3.0/node_modules/pkg-types/dist/index.d.mts
type StripEnums<T extends Record<string, any>> = { [K in keyof T]: T[K] extends boolean ? T[K] : T[K] extends string ? T[K] : T[K] extends object ? T[K] : T[K] extends Array<any> ? T[K] : T[K] extends undefined ? undefined : any };
interface TSConfig {
  compilerOptions?: StripEnums<CompilerOptions>;
  exclude?: string[];
  compileOnSave?: boolean;
  extends?: string | string[];
  files?: string[];
  include?: string[];
  typeAcquisition?: TypeAcquisition;
  references?: {
    path: string;
  }[];
}
/**
 * Defines a TSConfig structure.
 * @param tsconfig - The contents of `tsconfig.json` as an object. See {@link TSConfig}.
 * @returns the same `tsconfig.json` object.
 */
//#endregion
//#endregion
//#region ../../node_modules/.pnpm/nitro@3.0.1-alpha.2_ioredis@5.9.1_rolldown@1.0.0-rc.3_rollup@4.57.1_vite@7.3.1_@types+n_bc95901b35857ac86ce0ed75e4a2aaa2/node_modules/nitro/dist/_libs/magic-string.d.mts
//#region node_modules/.pnpm/magic-string@0.30.21/node_modules/magic-string/dist/magic-string.es.d.mts
interface SourceMapOptions {
  /**
   * Whether the mapping should be high-resolution.
   * Hi-res mappings map every single character, meaning (for example) your devtools will always
   * be able to pinpoint the exact location of function calls and so on.
   * With lo-res mappings, devtools may only be able to identify the correct
   * line - but they're quicker to generate and less bulky.
   * You can also set `"boundary"` to generate a semi-hi-res mappings segmented per word boundary
   * instead of per character, suitable for string semantics that are separated by words.
   * If sourcemap locations have been specified with s.addSourceMapLocation(), they will be used here.
   */
  hires?: boolean | 'boundary';
  /**
   * The filename where you plan to write the sourcemap.
   */
  file?: string;
  /**
   * The filename of the file containing the original source.
   */
  source?: string;
  /**
   * Whether to include the original content in the map's sourcesContent array.
   */
  includeContent?: boolean;
}
type SourceMapSegment = [number] | [number, number, number, number] | [number, number, number, number, number];
interface DecodedSourceMap {
  file: string;
  sources: string[];
  sourcesContent?: string[];
  names: string[];
  mappings: SourceMapSegment[][];
  x_google_ignoreList?: number[];
}
declare class SourceMap {
  constructor(properties: DecodedSourceMap);
  version: number;
  file: string;
  sources: string[];
  sourcesContent?: string[];
  names: string[];
  mappings: string;
  x_google_ignoreList?: number[];
  debugId?: string;
  /**
   * Returns the equivalent of `JSON.stringify(map)`
   */
  toString(): string;
  /**
   * Returns a DataURI containing the sourcemap. Useful for doing this sort of thing:
   * `generateMap(options?: SourceMapOptions): SourceMap;`
   */
  toUrl(): string;
}
type ExclusionRange = [number, number];
interface MagicStringOptions {
  filename?: string;
  indentExclusionRanges?: ExclusionRange | Array<ExclusionRange>;
  offset?: number;
}
interface IndentOptions {
  exclude?: ExclusionRange | Array<ExclusionRange>;
  indentStart?: boolean;
}
interface OverwriteOptions {
  storeName?: boolean;
  contentOnly?: boolean;
}
interface UpdateOptions {
  storeName?: boolean;
  overwrite?: boolean;
}
declare class MagicString {
  constructor(str: string, options?: MagicStringOptions);
  /**
   * Adds the specified character index (with respect to the original string) to sourcemap mappings, if `hires` is false.
   */
  addSourcemapLocation(char: number): void;
  /**
   * Appends the specified content to the end of the string.
   */
  append(content: string): this;
  /**
   * Appends the specified content at the index in the original string.
   * If a range *ending* with index is subsequently moved, the insert will be moved with it.
   * See also `s.prependLeft(...)`.
   */
  appendLeft(index: number, content: string): this;
  /**
   * Appends the specified content at the index in the original string.
   * If a range *starting* with index is subsequently moved, the insert will be moved with it.
   * See also `s.prependRight(...)`.
   */
  appendRight(index: number, content: string): this;
  /**
   * Does what you'd expect.
   */
  clone(): this;
  /**
   * Generates a version 3 sourcemap.
   */
  generateMap(options?: SourceMapOptions): SourceMap;
  /**
   * Generates a sourcemap object with raw mappings in array form, rather than encoded as a string.
   * Useful if you need to manipulate the sourcemap further, but most of the time you will use `generateMap` instead.
   */
  generateDecodedMap(options?: SourceMapOptions): DecodedSourceMap;
  getIndentString(): string;
  /**
   * Prefixes each line of the string with prefix.
   * If prefix is not supplied, the indentation will be guessed from the original content, falling back to a single tab character.
   */
  indent(options?: IndentOptions): this;
  /**
   * Prefixes each line of the string with prefix.
   * If prefix is not supplied, the indentation will be guessed from the original content, falling back to a single tab character.
   *
   * The options argument can have an exclude property, which is an array of [start, end] character ranges.
   * These ranges will be excluded from the indentation - useful for (e.g.) multiline strings.
   */
  indent(indentStr?: string, options?: IndentOptions): this;
  indentExclusionRanges: ExclusionRange | Array<ExclusionRange>;
  /**
   * Moves the characters from `start` and `end` to `index`.
   */
  move(start: number, end: number, index: number): this;
  /**
   * Replaces the characters from `start` to `end` with `content`, along with the appended/prepended content in
   * that range. The same restrictions as `s.remove()` apply.
   *
   * The fourth argument is optional. It can have a storeName property — if true, the original name will be stored
   * for later inclusion in a sourcemap's names array — and a contentOnly property which determines whether only
   * the content is overwritten, or anything that was appended/prepended to the range as well.
   *
   * It may be preferred to use `s.update(...)` instead if you wish to avoid overwriting the appended/prepended content.
   */
  overwrite(start: number, end: number, content: string, options?: boolean | OverwriteOptions): this;
  /**
   * Replaces the characters from `start` to `end` with `content`. The same restrictions as `s.remove()` apply.
   *
   * The fourth argument is optional. It can have a storeName property — if true, the original name will be stored
   * for later inclusion in a sourcemap's names array — and an overwrite property which determines whether only
   * the content is overwritten, or anything that was appended/prepended to the range as well.
   */
  update(start: number, end: number, content: string, options?: boolean | UpdateOptions): this;
  /**
   * Prepends the string with the specified content.
   */
  prepend(content: string): this;
  /**
   * Same as `s.appendLeft(...)`, except that the inserted content will go *before* any previous appends or prepends at index
   */
  prependLeft(index: number, content: string): this;
  /**
   * Same as `s.appendRight(...)`, except that the inserted content will go *before* any previous appends or prepends at `index`
   */
  prependRight(index: number, content: string): this;
  /**
   * Removes the characters from `start` to `end` (of the original string, **not** the generated string).
   * Removing the same content twice, or making removals that partially overlap, will cause an error.
   */
  remove(start: number, end: number): this;
  /**
   * Reset the modified characters from `start` to `end` (of the original string, **not** the generated string).
   */
  reset(start: number, end: number): this;
  /**
   * Returns the content of the generated string that corresponds to the slice between `start` and `end` of the original string.
   * Throws error if the indices are for characters that were already removed.
   */
  slice(start: number, end: number): string;
  /**
   * Returns a clone of `s`, with all content before the `start` and `end` characters of the original string removed.
   */
  snip(start: number, end: number): this;
  /**
   * Trims content matching `charType` (defaults to `\s`, i.e. whitespace) from the start and end.
   */
  trim(charType?: string): this;
  /**
   * Trims content matching `charType` (defaults to `\s`, i.e. whitespace) from the start.
   */
  trimStart(charType?: string): this;
  /**
   * Trims content matching `charType` (defaults to `\s`, i.e. whitespace) from the end.
   */
  trimEnd(charType?: string): this;
  /**
   * Removes empty lines from the start and end.
   */
  trimLines(): this;
  /**
   * String replacement with RegExp or string.
   */
  replace(regex: RegExp | string, replacement: string | ((substring: string, ...args: any[]) => string)): this;
  /**
   * Same as `s.replace`, but replace all matched strings instead of just one.
   */
  replaceAll(regex: RegExp | string, replacement: string | ((substring: string, ...args: any[]) => string)): this;
  lastChar(): string;
  lastLine(): string;
  /**
   * Returns true if the resulting source is empty (disregarding white space).
   */
  isEmpty(): boolean;
  length(): number;
  /**
   * Indicates if the string has been changed.
   */
  hasChanged(): boolean;
  original: string;
  /**
   * Returns the generated string.
   */
  toString(): string;
  offset: number;
} //#endregion
//#endregion
//#region ../../node_modules/.pnpm/nitro@3.0.1-alpha.2_ioredis@5.9.1_rolldown@1.0.0-rc.3_rollup@4.57.1_vite@7.3.1_@types+n_bc95901b35857ac86ce0ed75e4a2aaa2/node_modules/nitro/dist/_libs/mlly.d.mts
//#region node_modules/.pnpm/mlly@1.8.0/node_modules/mlly/dist/index.d.ts
/**
 * Represents a general structure for ECMAScript module exports.
 */
interface ESMExport {
  /**
   * Optional explicit type for complex scenarios, often used internally.
   * @optional
   */
  _type?: "declaration" | "named" | "default" | "star";
  /**
   * The type of export (declaration, named, default or star).
   */
  type: "declaration" | "named" | "default" | "star";
  /**
   * The specific type of declaration being exported, if applicable.
   * @optional
   */
  declarationType?: "let" | "var" | "const" | "enum" | "const enum" | "class" | "function" | "async function";
  /**
   * The full code snippet of the export statement.
   */
  code: string;
  /**
   * The starting position (index) of the export declaration in the source code.
   */
  start: number;
  /**
   * The end position (index) of the export declaration in the source code.
   */
  end: number;
  /**
   * The name of the variable, function or class being exported, if given explicitly.
   * @optional
   */
  name?: string;
  /**
   * The name used for default exports when a specific identifier isn't given.
   * @optional
   */
  defaultName?: string;
  /**
   * An array of names to export, applicable to named and destructured exports.
   */
  names: string[];
  /**
   * The module specifier, if any, from which exports are being re-exported.
   * @optional
   */
  specifier?: string;
}
/**
 * Represents a declaration export within an ECMAScript module.
 * Extends {@link ESMExport}.
 */
//#endregion
//#endregion
//#region ../../node_modules/.pnpm/nitro@3.0.1-alpha.2_ioredis@5.9.1_rolldown@1.0.0-rc.3_rollup@4.57.1_vite@7.3.1_@types+n_bc95901b35857ac86ce0ed75e4a2aaa2/node_modules/nitro/dist/_libs/unplugin+unimport.d.mts
//#region node_modules/.pnpm/unplugin-utils@0.3.1/node_modules/unplugin-utils/dist/index.d.ts
//#region src/filter.d.ts
/**
* A valid `picomatch` glob pattern, or array of patterns.
*/
type FilterPattern = ReadonlyArray<string | RegExp> | string | RegExp | null;
/**
* Constructs a filter function which can be used to determine whether or not
* certain modules should be operated upon.
* @param include If `include` is omitted or has zero length, filter will return `true` by default.
* @param exclude ID must not match any of the `exclude` patterns.
* @param options Additional options.
* @param options.resolve Optionally resolves the patterns against a directory other than `process.cwd()`.
* If a `string` is specified, then the value will be used as the base directory.
* Relative paths will be resolved against `process.cwd()` first.
* If `false`, then the patterns will not be resolved against any directory.
* This can be useful if you want to create a filter for virtual module names.
*/
//#endregion
//#region node_modules/.pnpm/unimport@5.6.0/node_modules/unimport/dist/shared/unimport.C0UbTDPO.d.mts
declare const builtinPresets: {
  '@vue/composition-api': InlinePreset;
  '@vueuse/core': () => Preset;
  '@vueuse/head': InlinePreset;
  pinia: InlinePreset;
  preact: InlinePreset;
  quasar: InlinePreset;
  react: InlinePreset;
  'react-router': InlinePreset;
  'react-router-dom': InlinePreset;
  svelte: InlinePreset;
  'svelte/animate': InlinePreset;
  'svelte/easing': InlinePreset;
  'svelte/motion': InlinePreset;
  'svelte/store': InlinePreset;
  'svelte/transition': InlinePreset;
  'vee-validate': InlinePreset;
  vitepress: InlinePreset;
  'vue-demi': InlinePreset;
  'vue-i18n': InlinePreset;
  'vue-router': InlinePreset;
  'vue-router-composables': InlinePreset;
  vue: InlinePreset;
  'vue/macros': InlinePreset;
  vuex: InlinePreset;
  vitest: InlinePreset;
  'uni-app': InlinePreset;
  'solid-js': InlinePreset;
  'solid-app-router': InlinePreset;
  rxjs: InlinePreset;
  'date-fns': InlinePreset;
};
type BuiltinPresetName = keyof typeof builtinPresets;
type ModuleId = string;
type ImportName = string;
interface ImportCommon {
  /** Module specifier to import from */
  from: ModuleId;
  /**
   * Priority of the import, if multiple imports have the same name, the one with the highest priority will be used
   * @default 1
   */
  priority?: number;
  /** If this import is disabled */
  disabled?: boolean;
  /** Won't output import in declaration file if true */
  dtsDisabled?: boolean;
  /** Import declaration type like const / var / enum */
  declarationType?: ESMExport['declarationType'];
  /**
   * Metadata of the import
   */
  meta?: {
    /** Short description of the import */description?: string; /** URL to the documentation */
    docsUrl?: string; /** Additional metadata */
    [key: string]: any;
  };
  /**
   * If this import is a pure type import
   */
  type?: boolean;
  /**
   * Using this as the from when generating type declarations
   */
  typeFrom?: ModuleId;
}
interface Import extends ImportCommon {
  /** Import name to be detected */
  name: ImportName;
  /** Import as this name */
  as?: ImportName;
  /**
   * With properties
   *
   * Ignored for CJS imports.
   */
  with?: Record<string, string>;
}
type PresetImport = Omit<Import, 'from'> | ImportName | [name: ImportName, as?: ImportName, from?: ModuleId];
interface InlinePreset extends ImportCommon {
  imports: (PresetImport | InlinePreset)[];
}
/**
 * Auto extract exports from a package for auto import
 */
interface PackagePreset {
  /**
   * Name of the package
   */
  package: string;
  /**
   * Path of the importer
   * @default process.cwd()
   */
  url?: string;
  /**
   * RegExp, string, or custom function to exclude names of the extracted imports
   */
  ignore?: (string | RegExp | ((name: string) => boolean))[];
  /**
   * Use local cache if exits
   * @default true
   */
  cache?: boolean;
}
type Preset = InlinePreset | PackagePreset;
interface UnimportContext {
  readonly version: string;
  options: Partial<UnimportOptions>;
  staticImports: Import[];
  dynamicImports: Import[];
  addons: Addon[];
  getImports: () => Promise<Import[]>;
  getImportMap: () => Promise<Map<string, Import>>;
  getMetadata: () => UnimportMeta | undefined;
  modifyDynamicImports: (fn: (imports: Import[]) => Thenable<void | Import[]>) => Promise<void>;
  clearDynamicImports: () => void;
  replaceImports: (imports: UnimportOptions['imports']) => Promise<Import[]>;
  invalidate: () => void;
  resolveId: (id: string, parentId?: string) => Thenable<string | null | undefined | void>;
}
interface DetectImportResult {
  s: MagicString;
  strippedCode: string;
  isCJSContext: boolean;
  matchedImports: Import[];
  firstOccurrence: number;
}
interface Unimport {
  readonly version: string;
  init: () => Promise<void>;
  clearDynamicImports: UnimportContext['clearDynamicImports'];
  getImportMap: UnimportContext['getImportMap'];
  getImports: UnimportContext['getImports'];
  getInternalContext: () => UnimportContext;
  getMetadata: UnimportContext['getMetadata'];
  modifyDynamicImports: UnimportContext['modifyDynamicImports'];
  generateTypeDeclarations: (options?: TypeDeclarationOptions) => Promise<string>;
  /**
   * Get un-imported usages from code
   */
  detectImports: (code: string | MagicString) => Promise<DetectImportResult>;
  /**
   * Insert missing imports statements to code
   */
  injectImports: (code: string | MagicString, id?: string, options?: InjectImportsOptions) => Promise<ImportInjectionResult>;
  scanImportsFromDir: (dir?: (string | ScanDir)[], options?: ScanDirExportsOptions) => Promise<Import[]>;
  scanImportsFromFile: (file: string, includeTypes?: boolean) => Promise<Import[]>;
  /**
   * @deprecated
   */
  toExports: (filepath?: string, includeTypes?: boolean) => Promise<string>;
}
interface InjectionUsageRecord {
  import: Import;
  count: number;
  moduleIds: string[];
}
interface UnimportMeta {
  injectionUsage: Record<string, InjectionUsageRecord>;
}
interface AddonsOptions {
  addons?: Addon[];
  /**
   * Enable auto import inside for Vue's <template>
   *
   * @default false
   */
  vueTemplate?: boolean;
  /**
   * Enable auto import directives for Vue's SFC.
   *
   * Library authors should include `meta.vueDirective: true` in the import metadata.
   *
   * When using a local directives folder, provide the `isDirective`
   * callback to check if the import is a Vue directive.
   */
  vueDirectives?: true | AddonVueDirectivesOptions;
}
interface AddonVueDirectivesOptions {
  /**
   * Checks if the import is a Vue directive.
   *
   * **NOTES**:
   * - imports from a library should include `meta.vueDirective: true`.
   * - this callback is only invoked for local directives (only when meta.vueDirective is not set).
   *
   * @param from The path of the import normalized.
   * @param importEntry The import entry.
   */
  isDirective?: (from: string, importEntry: Import) => boolean;
}
interface UnimportOptions extends Pick<InjectImportsOptions, 'injectAtEnd' | 'mergeExisting' | 'parser'> {
  /**
   * Auto import items
   */
  imports: Import[];
  /**
   * Auto import preset
   */
  presets: (Preset | BuiltinPresetName)[];
  /**
   * Custom warning function
   * @default console.warn
   */
  warn: (msg: string) => void;
  /**
   * Custom debug log function
   * @default console.log
   */
  debugLog: (msg: string) => void;
  /**
   * Unimport Addons.
   * To use built-in addons, use:
   * ```js
   * addons: {
   *   addons: [<custom-addons-here>] // if you want to use also custom addons
   *   vueTemplate: true,
   *   vueDirectives: [<the-directives-here>]
   * }
   * ```
   *
   * Built-in addons:
   * - vueDirectives: enable auto import directives for Vue's SFC
   * - vueTemplate: enable auto import inside for Vue's <template>
   *
   * @default {}
   */
  addons: AddonsOptions | Addon[];
  /**
   * Name of virtual modules that exposed all the registed auto-imports
   * @default []
   */
  virtualImports: string[];
  /**
   * Directories to scan for auto import
   * @default []
   */
  dirs?: (string | ScanDir)[];
  /**
   * Options for scanning directories for auto import
   */
  dirsScanOptions?: ScanDirExportsOptions;
  /**
   * Custom resolver to auto import id
   */
  resolveId?: (id: string, importee?: string) => Thenable<string | void>;
  /**
   * Custom magic comments to be opt-out for auto import, per file/module
   *
   * @default ['@unimport-disable', '@imports-disable']
   */
  commentsDisable?: string[];
  /**
   * Custom magic comments to debug auto import, printed to console
   *
   * @default ['@unimport-debug', '@imports-debug']
   */
  commentsDebug?: string[];
  /**
   * Collect meta data for each auto import. Accessible via `ctx.meta`
   */
  collectMeta?: boolean;
}
type PathFromResolver = (_import: Import) => string | undefined;
interface ScanDirExportsOptions {
  /**
   * Glob patterns for matching files
   *
   * @default ['*.{ts,js,mjs,cjs,mts,cts,tsx,jsx}']
   */
  filePatterns?: string[];
  /**
   * Custom function to filter scanned files
   */
  fileFilter?: (file: string) => boolean;
  /**
   * Register type exports
   *
   * @default true
   */
  types?: boolean;
  /**
   * Current working directory
   *
   * @default process.cwd()
   */
  cwd?: string;
}
interface ScanDir {
  /**
   * Path pattern of the directory
   */
  glob: string;
  /**
   * Register type exports
   *
   * @default true
   */
  types?: boolean;
}
interface TypeDeclarationOptions {
  /**
   * Custom resolver for path of the import
   */
  resolvePath?: PathFromResolver;
  /**
   * Append `export {}` to the end of the file
   *
   * @default true
   */
  exportHelper?: boolean;
  /**
   * Auto-import for type exports
   *
   * @default true
   */
  typeReExports?: boolean;
}
interface InjectImportsOptions {
  /**
   * Merge the existing imports
   *
   * @default false
   */
  mergeExisting?: boolean;
  /**
   * If the module should be auto imported
   *
   * @default true
   */
  autoImport?: boolean;
  /**
   * If the module should be transformed for virtual modules.
   * Only available when `virtualImports` is set.
   *
   * @default true
   */
  transformVirtualImports?: boolean;
  /**
   * Parser to use for parsing the code
   *
   * Note that `acorn` only takes valid JS Code, should usually only be used after transformationa and transpilation
   *
   * @default 'regex'
   */
  parser?: 'acorn' | 'regex';
  /**
   * Inject the imports at the end of other imports
   *
   * @default false
   */
  injectAtEnd?: boolean;
}
type Thenable<T> = Promise<T> | T;
interface Addon {
  name?: string;
  transform?: (this: UnimportContext, code: MagicString, id: string | undefined) => Thenable<MagicString>;
  declaration?: (this: UnimportContext, dts: string, options: TypeDeclarationOptions) => Thenable<string>;
  matchImports?: (this: UnimportContext, identifiers: Set<string>, matched: Import[]) => Thenable<Import[] | void>;
  /**
   * Extend or modify the imports list before injecting
   */
  extendImports?: (this: UnimportContext, imports: Import[]) => Import[] | void;
  /**
   * Resolve imports before injecting
   */
  injectImportsResolved?: (this: UnimportContext, imports: Import[], code: MagicString, id?: string) => Import[] | void;
  /**
   * Modify the injection code before injecting
   */
  injectImportsStringified?: (this: UnimportContext, injection: string, imports: Import[], code: MagicString, id?: string) => string | void;
}
interface MagicStringResult {
  s: MagicString;
  code: string;
}
interface ImportInjectionResult extends MagicStringResult {
  imports: Import[];
} //#endregion
//#region node_modules/.pnpm/unimport@5.6.0/node_modules/unimport/dist/unplugin.d.mts
interface UnimportPluginOptions extends UnimportOptions {
  include: FilterPattern;
  exclude: FilterPattern;
  dts: boolean | string;
  /**
   * Enable implicit auto import.
   * Generate global TypeScript definitions.
   *
   * @default true
   */
  autoImport?: boolean;
} //#endregion
//#endregion
//#region ../../node_modules/.pnpm/nitro@3.0.1-alpha.2_ioredis@5.9.1_rolldown@1.0.0-rc.3_rollup@4.57.1_vite@7.3.1_@types+n_bc95901b35857ac86ce0ed75e4a2aaa2/node_modules/nitro/dist/_libs/esbuild.d.mts
//#region node_modules/.pnpm/esbuild@0.27.2/node_modules/esbuild/lib/main.d.ts
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
//#region ../../node_modules/.pnpm/nitro@3.0.1-alpha.2_ioredis@5.9.1_rolldown@1.0.0-rc.3_rollup@4.57.1_vite@7.3.1_@types+n_bc95901b35857ac86ce0ed75e4a2aaa2/node_modules/nitro/dist/_libs/unwasm.d.mts
//#region node_modules/.pnpm/unwasm@0.5.3/node_modules/unwasm/dist/plugin/index.d.mts
//#region src/plugin/shared.d.ts
interface UnwasmPluginOptions {
  /**
   * Directly import the `.wasm` files instead of bundling as base64 string.
   *
   * @default false
   */
  esmImport?: boolean;
  /**
   * Avoid using top level await and always use a proxy.
   *
   * Useful for compatibility with environments that don't support top level await.
   *
   * @default false
   */
  lazy?: boolean;
  /**
   * Suppress all warnings from the plugin.
   *
   * @default false
   */
  silent?: boolean;
} //#endregion
//#region src/plugin/index.d.ts
//#endregion
//#endregion
//#region ../../node_modules/.pnpm/nitro@3.0.1-alpha.2_ioredis@5.9.1_rolldown@1.0.0-rc.3_rollup@4.57.1_vite@7.3.1_@types+n_bc95901b35857ac86ce0ed75e4a2aaa2/node_modules/nitro/dist/_libs/rou3.d.mts
//#region node_modules/.pnpm/rou3@0.7.12/node_modules/rou3/dist/index.d.mts
interface RouterContext<T = unknown> {
  root: Node<T>;
  static: Record<string, Node<T> | undefined>;
}
type ParamsIndexMap = Array<[Index: number, name: string | RegExp, optional: boolean]>;
type MethodData<T = unknown> = {
  data: T;
  paramsMap?: ParamsIndexMap;
  paramsRegexp: RegExp[];
};
interface Node<T = unknown> {
  key: string;
  static?: Record<string, Node<T>>;
  param?: Node<T>;
  wildcard?: Node<T>;
  hasRegexParam?: boolean;
  methods?: Record<string, MethodData<T>[] | undefined>;
} //#endregion
//#region node_modules/.pnpm/rou3@0.7.12/node_modules/rou3/dist/compiler.d.mts
interface RouterCompilerOptions<T = any> {
  matchAll?: boolean;
  serialize?: (data: T) => string;
}
/**
* Compiles the router instance into a faster route-matching function.
*
* **IMPORTANT:** `compileRouter` requires eval support with `new Function()` in the runtime for JIT compilation.
*
* @example
* import { createRouter, addRoute } from "rou3";
* import { compileRouter } from "rou3/compiler";
* const router = createRouter();
* // [add some routes]
* const findRoute = compileRouter(router);
* const matchAll = compileRouter(router, { matchAll: true });
* findRoute("GET", "/path/foo/bar");
*
* @param router - The router context to compile.
*/
//#endregion
//#endregion
//#region ../../node_modules/.pnpm/nitro@3.0.1-alpha.2_ioredis@5.9.1_rolldown@1.0.0-rc.3_rollup@4.57.1_vite@7.3.1_@types+n_bc95901b35857ac86ce0ed75e4a2aaa2/node_modules/nitro/dist/runtime/internal/app.d.mts
declare global {
  var __nitro__: Partial<Record<"default" | "prerender" | (string & {}), NitroApp | undefined>> | undefined;
}
//#endregion
//#region ../../node_modules/.pnpm/oxc-transform@0.110.0/node_modules/oxc-transform/index.d.ts
interface CompilerAssumptions {
  ignoreFunctionLength?: boolean;
  noDocumentAll?: boolean;
  objectRestNoSymbols?: boolean;
  pureGetters?: boolean;
  /**
   * When using public class fields, assume that they don't shadow any getter in the current class,
   * in its subclasses or in its superclass. Thus, it's safe to assign them rather than using
   * `Object.defineProperty`.
   *
   * For example:
   *
   * Input:
   * ```js
   * class Test {
   *  field = 2;
   *
   *  static staticField = 3;
   * }
   * ```
   *
   * When `set_public_class_fields` is `true`, the output will be:
   * ```js
   * class Test {
   *  constructor() {
   *    this.field = 2;
   *  }
   * }
   * Test.staticField = 3;
   * ```
   *
   * Otherwise, the output will be:
   * ```js
   * import _defineProperty from "@oxc-project/runtime/helpers/defineProperty";
   * class Test {
   *   constructor() {
   *     _defineProperty(this, "field", 2);
   *   }
   * }
   * _defineProperty(Test, "staticField", 3);
   * ```
   *
   * NOTE: For TypeScript, if you wanted behavior is equivalent to `useDefineForClassFields: false`, you should
   * set both `set_public_class_fields` and [`crate::TypeScriptOptions::remove_class_fields_without_initializer`]
   * to `true`.
   */
  setPublicClassFields?: boolean;
}
interface DecoratorOptions {
  /**
   * Enables experimental support for decorators, which is a version of decorators that predates the TC39 standardization process.
   *
   * Decorators are a language feature which hasn’t yet been fully ratified into the JavaScript specification.
   * This means that the implementation version in TypeScript may differ from the implementation in JavaScript when it it decided by TC39.
   *
   * @see https://www.typescriptlang.org/tsconfig/#experimentalDecorators
   * @default false
   */
  legacy?: boolean;
  /**
   * Enables emitting decorator metadata.
   *
   * This option the same as [emitDecoratorMetadata](https://www.typescriptlang.org/tsconfig/#emitDecoratorMetadata)
   * in TypeScript, and it only works when `legacy` is true.
   *
   * @see https://www.typescriptlang.org/tsconfig/#emitDecoratorMetadata
   * @default false
   */
  emitDecoratorMetadata?: boolean;
}
declare const enum HelperMode {
  /**
   * Runtime mode (default): Helper functions are imported from a runtime package.
   *
   * Example:
   *
   * ```js
   * import helperName from "@oxc-project/runtime/helpers/helperName";
   * helperName(...arguments);
   * ```
   */
  Runtime = 'Runtime',
  /**
   * External mode: Helper functions are accessed from a global `babelHelpers` object.
   *
   * Example:
   *
   * ```js
   * babelHelpers.helperName(...arguments);
   * ```
   */
  External = 'External'
}
interface Helpers {
  mode?: HelperMode;
}
interface IsolatedDeclarationsOptions {
  /**
   * Do not emit declarations for code that has an @internal annotation in its JSDoc comment.
   * This is an internal compiler option; use at your own risk, because the compiler does not check that the result is valid.
   *
   * Default: `false`
   *
   * See <https://www.typescriptlang.org/tsconfig/#stripInternal>
   */
  stripInternal?: boolean;
  sourcemap?: boolean;
}
/**
 * Configure how TSX and JSX are transformed.
 *
 * @see {@link https://babeljs.io/docs/babel-plugin-transform-react-jsx#options}
 */
interface JsxOptions {
  /**
   * Decides which runtime to use.
   *
   * - 'automatic' - auto-import the correct JSX factories
   * - 'classic' - no auto-import
   *
   * @default 'automatic'
   */
  runtime?: 'classic' | 'automatic';
  /**
   * Emit development-specific information, such as `__source` and `__self`.
   *
   * @default false
   *
   * @see {@link https://babeljs.io/docs/babel-plugin-transform-react-jsx-development}
   */
  development?: boolean;
  /**
   * Toggles whether or not to throw an error if an XML namespaced tag name
   * is used.
   *
   * Though the JSX spec allows this, it is disabled by default since React's
   * JSX does not currently have support for it.
   *
   * @default true
   */
  throwIfNamespace?: boolean;
  /**
   * Enables `@babel/plugin-transform-react-pure-annotations`.
   *
   * It will mark JSX elements and top-level React method calls as pure for tree shaking.
   *
   * @see {@link https://babeljs.io/docs/en/babel-plugin-transform-react-pure-annotations}
   *
   * @default true
   */
  pure?: boolean;
  /**
   * Replaces the import source when importing functions.
   *
   * @default 'react'
   */
  importSource?: string;
  /**
   * Replace the function used when compiling JSX expressions. It should be a
   * qualified name (e.g. `React.createElement`) or an identifier (e.g.
   * `createElement`).
   *
   * Only used for `classic` {@link runtime}.
   *
   * @default 'React.createElement'
   */
  pragma?: string;
  /**
   * Replace the component used when compiling JSX fragments. It should be a
   * valid JSX tag name.
   *
   * Only used for `classic` {@link runtime}.
   *
   * @default 'React.Fragment'
   */
  pragmaFrag?: string;
  /**
   * When spreading props, use `Object.assign` directly instead of an extend helper.
   *
   * Only used for `classic` {@link runtime}.
   *
   * @default false
   */
  useBuiltIns?: boolean;
  /**
   * When spreading props, use inline object with spread elements directly
   * instead of an extend helper or Object.assign.
   *
   * Only used for `classic` {@link runtime}.
   *
   * @default false
   */
  useSpread?: boolean;
  /**
   * Enable React Fast Refresh .
   *
   * Conforms to the implementation in {@link https://github.com/facebook/react/tree/v18.3.1/packages/react-refresh}
   *
   * @default false
   */
  refresh?: boolean | ReactRefreshOptions;
}
interface PluginsOptions {
  styledComponents?: StyledComponentsOptions;
  taggedTemplateEscape?: boolean;
}
interface ReactRefreshOptions {
  /**
   * Specify the identifier of the refresh registration variable.
   *
   * @default `$RefreshReg$`.
   */
  refreshReg?: string;
  /**
   * Specify the identifier of the refresh signature variable.
   *
   * @default `$RefreshSig$`.
   */
  refreshSig?: string;
  emitFullSignatures?: boolean;
}
/**
 * Configure how styled-components are transformed.
 *
 * @see {@link https://styled-components.com/docs/tooling#babel-plugin}
 */
interface StyledComponentsOptions {
  /**
   * Enhances the attached CSS class name on each component with richer output to help
   * identify your components in the DOM without React DevTools.
   *
   * @default true
   */
  displayName?: boolean;
  /**
   * Controls whether the `displayName` of a component will be prefixed with the filename
   * to make the component name as unique as possible.
   *
   * @default true
   */
  fileName?: boolean;
  /**
   * Adds a unique identifier to every styled component to avoid checksum mismatches
   * due to different class generation on the client and server during server-side rendering.
   *
   * @default true
   */
  ssr?: boolean;
  /**
   * Transpiles styled-components tagged template literals to a smaller representation
   * than what Babel normally creates, helping to reduce bundle size.
   *
   * @default true
   */
  transpileTemplateLiterals?: boolean;
  /**
   * Minifies CSS content by removing all whitespace and comments from your CSS,
   * keeping valuable bytes out of your bundles.
   *
   * @default true
   */
  minify?: boolean;
  /**
   * Enables transformation of JSX `css` prop when using styled-components.
   *
   * **Note: This feature is not yet implemented in oxc.**
   *
   * @default true
   */
  cssProp?: boolean;
  /**
   * Enables "pure annotation" to aid dead code elimination by bundlers.
   *
   * @default false
   */
  pure?: boolean;
  /**
   * Adds a namespace prefix to component identifiers to ensure class names are unique.
   *
   * Example: With `namespace: "my-app"`, generates `componentId: "my-app__sc-3rfj0a-1"`
   */
  namespace?: string;
  /**
   * List of file names that are considered meaningless for component naming purposes.
   *
   * When the `fileName` option is enabled and a component is in a file with a name
   * from this list, the directory name will be used instead of the file name for
   * the component's display name.
   *
   * @default `["index"]`
   */
  meaninglessFileNames?: Array<string>;
  /**
   * Import paths to be considered as styled-components imports at the top level.
   *
   * **Note: This feature is not yet implemented in oxc.**
   */
  topLevelImportPaths?: Array<string>;
}
/**
 * Options for transforming a JavaScript or TypeScript file.
 *
 * @see {@link transform}
 */
interface TransformOptions {
  /** Treat the source text as `js`, `jsx`, `ts`, `tsx`, or `dts`. */
  lang?: 'js' | 'jsx' | 'ts' | 'tsx' | 'dts';
  /** Treat the source text as `script` or `module` code. */
  sourceType?: 'script' | 'module' | 'commonjs' | 'unambiguous' | undefined;
  /**
   * The current working directory. Used to resolve relative paths in other
   * options.
   */
  cwd?: string;
  /**
   * Enable source map generation.
   *
   * When `true`, the `sourceMap` field of transform result objects will be populated.
   *
   * @default false
   *
   * @see {@link SourceMap}
   */
  sourcemap?: boolean;
  /** Set assumptions in order to produce smaller output. */
  assumptions?: CompilerAssumptions;
  /** Configure how TypeScript is transformed. */
  typescript?: TypeScriptOptions;
  /** Configure how TSX and JSX are transformed. */
  jsx?: 'preserve' | JsxOptions;
  /**
   * Sets the target environment for the generated JavaScript.
   *
   * The lowest target is `es2015`.
   *
   * Example:
   *
   * * `'es2015'`
   * * `['es2020', 'chrome58', 'edge16', 'firefox57', 'node12', 'safari11']`
   *
   * @default `esnext` (No transformation)
   *
   * @see [esbuild#target](https://esbuild.github.io/api/#target)
   */
  target?: string | Array<string>;
  /** Behaviour for runtime helpers. */
  helpers?: Helpers;
  /** Define Plugin */
  define?: Record<string, string>;
  /** Inject Plugin */
  inject?: Record<string, string | [string, string]>;
  /** Decorator plugin */
  decorator?: DecoratorOptions;
  /** Third-party plugins to use. */
  plugins?: PluginsOptions;
}
interface TypeScriptOptions {
  jsxPragma?: string;
  jsxPragmaFrag?: string;
  onlyRemoveTypeImports?: boolean;
  allowNamespaces?: boolean;
  /**
   * When enabled, type-only class fields are only removed if they are prefixed with the declare modifier:
   *
   * @deprecated
   *
   * Allowing `declare` fields is built-in support in Oxc without any option. If you want to remove class fields
   * without initializer, you can use `remove_class_fields_without_initializer: true` instead.
   */
  allowDeclareFields?: boolean;
  /**
   * When enabled, class fields without initializers are removed.
   *
   * For example:
   * ```ts
   * class Foo {
   *    x: number;
   *    y: number = 0;
   * }
   * ```
   * // transform into
   * ```js
   * class Foo {
   *    x: number;
   * }
   * ```
   *
   * The option is used to align with the behavior of TypeScript's `useDefineForClassFields: false` option.
   * When you want to enable this, you also need to set [`crate::CompilerAssumptions::set_public_class_fields`]
   * to `true`. The `set_public_class_fields: true` + `remove_class_fields_without_initializer: true` is
   * equivalent to `useDefineForClassFields: false` in TypeScript.
   *
   * When `set_public_class_fields` is true and class-properties plugin is enabled, the above example transforms into:
   *
   * ```js
   * class Foo {
   *   constructor() {
   *     this.y = 0;
   *   }
   * }
   * ```
   *
   * Defaults to `false`.
   */
  removeClassFieldsWithoutInitializer?: boolean;
  /**
   * Also generate a `.d.ts` declaration file for TypeScript files.
   *
   * The source file must be compliant with all
   * [`isolatedDeclarations`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html#isolated-declarations)
   * requirements.
   *
   * @default false
   */
  declaration?: IsolatedDeclarationsOptions;
  /**
   * Rewrite or remove TypeScript import/export declaration extensions.
   *
   * - When set to `rewrite`, it will change `.ts`, `.mts`, `.cts` extensions to `.js`, `.mjs`, `.cjs` respectively.
   * - When set to `remove`, it will remove `.ts`/`.mts`/`.cts`/`.tsx` extension entirely.
   * - When set to `true`, it's equivalent to `rewrite`.
   * - When set to `false` or omitted, no changes will be made to the extensions.
   *
   * @default false
   */
  rewriteImportExtensions?: 'rewrite' | 'remove' | boolean;
}
//#endregion
//#region ../../node_modules/.pnpm/oxc-minify@0.110.0/node_modules/oxc-minify/index.d.ts
/* auto-generated by NAPI-RS */
/* eslint-disable */
interface CodegenOptions {
  /**
   * Remove whitespace.
   *
   * @default true
   */
  removeWhitespace?: boolean;
}
interface CompressOptions$1 {
  /**
   * Set desired EcmaScript standard version for output.
   *
   * Set `esnext` to enable all target highering.
   *
   * Example:
   *
   * * `'es2015'`
   * * `['es2020', 'chrome58', 'edge16', 'firefox57', 'node12', 'safari11']`
   *
   * @default 'esnext'
   *
   * @see [esbuild#target](https://esbuild.github.io/api/#target)
   */
  target?: string | Array<string>;
  /**
   * Pass true to discard calls to `console.*`.
   *
   * @default false
   */
  dropConsole?: boolean;
  /**
   * Remove `debugger;` statements.
   *
   * @default true
   */
  dropDebugger?: boolean;
  /**
   * Pass `true` to drop unreferenced functions and variables.
   *
   * Simple direct variable assignments do not count as references unless set to `keep_assign`.
   * @default true
   */
  unused?: boolean | 'keep_assign';
  /** Keep function / class names. */
  keepNames?: CompressOptionsKeepNames;
  /**
   * Join consecutive var, let and const statements.
   *
   * @default true
   */
  joinVars?: boolean;
  /**
   * Join consecutive simple statements using the comma operator.
   *
   * `a; b` -> `a, b`
   *
   * @default true
   */
  sequences?: boolean;
  /**
   * Set of label names to drop from the code.
   *
   * Labeled statements matching these names will be removed during minification.
   *
   * @default []
   */
  dropLabels?: Array<string>;
  /** Limit the maximum number of iterations for debugging purpose. */
  maxIterations?: number;
  /** Treeshake options. */
  treeshake?: TreeShakeOptions;
}
interface CompressOptionsKeepNames {
  /**
   * Keep function names so that `Function.prototype.name` is preserved.
   *
   * This does not guarantee that the `undefined` name is preserved.
   *
   * @default false
   */
  function: boolean;
  /**
   * Keep class names so that `Class.prototype.name` is preserved.
   *
   * This does not guarantee that the `undefined` name is preserved.
   *
   * @default false
   */
  class: boolean;
}
interface MangleOptions {
  /**
   * Pass `true` to mangle names declared in the top level scope.
   *
   * @default false
   */
  toplevel?: boolean;
  /**
   * Preserve `name` property for functions and classes.
   *
   * @default false
   */
  keepNames?: boolean | MangleOptionsKeepNames;
  /** Debug mangled names. */
  debug?: boolean;
}
interface MangleOptionsKeepNames {
  /**
   * Preserve `name` property for functions.
   *
   * @default false
   */
  function: boolean;
  /**
   * Preserve `name` property for classes.
   *
   * @default false
   */
  class: boolean;
}
interface MinifyOptions {
  /** Use when minifying an ES module. */
  module?: boolean;
  compress?: boolean | CompressOptions$1;
  mangle?: boolean | MangleOptions;
  codegen?: boolean | CodegenOptions;
  sourcemap?: boolean;
}
interface TreeShakeOptions {
  /**
   * Whether to respect the pure annotations.
   *
   * Pure annotations are comments that mark an expression as pure.
   * For example: @__PURE__ or #__NO_SIDE_EFFECTS__.
   *
   * @default true
   */
  annotations?: boolean;
  /**
   * Whether to treat this function call as pure.
   *
   * This function is called for normal function calls, new calls, and
   * tagged template calls.
   */
  manualPureFunctions?: Array<string>;
  /**
   * Whether property read accesses have side effects.
   *
   * @default 'always'
   */
  propertyReadSideEffects?: boolean | 'always';
  /**
   * Whether accessing a global variable has side effects.
   *
   * Accessing a non-existing global variable will throw an error.
   * Global variable may be a getter that has side effects.
   *
   * @default true
   */
  unknownGlobalSideEffects?: boolean;
  /**
   * Whether invalid import statements have side effects.
   *
   * Accessing a non-existing import name will throw an error.
   * Also import statements that cannot be resolved will throw an error.
   *
   * @default true
   */
  invalidImportSideEffects?: boolean;
}
//#endregion
//#region ../../node_modules/.pnpm/nitro@3.0.1-alpha.2_ioredis@5.9.1_rolldown@1.0.0-rc.3_rollup@4.57.1_vite@7.3.1_@types+n_bc95901b35857ac86ce0ed75e4a2aaa2/node_modules/nitro/dist/types/index.d.mts
//#endregion
//#region src/types/runtime/cache.d.ts
interface CacheEntry<T = any> {
  value?: T;
  expires?: number;
  mtime?: number;
  integrity?: string;
}
interface CacheOptions$1<T = any, ArgsT extends unknown[] = any[]> {
  name?: string;
  getKey?: (...args: ArgsT) => string | Promise<string>;
  transform?: (entry: CacheEntry<T>, ...args: ArgsT) => any;
  validate?: (entry: CacheEntry<T>, ...args: ArgsT) => boolean;
  shouldInvalidateCache?: (...args: ArgsT) => boolean | Promise<boolean>;
  shouldBypassCache?: (...args: ArgsT) => boolean | Promise<boolean>;
  group?: string;
  integrity?: any;
  /**
   * Number of seconds to cache the response. Defaults to 1.
   */
  maxAge?: number;
  swr?: boolean;
  staleMaxAge?: number;
  base?: string;
}
interface ResponseCacheEntry {
  status: number;
  statusText: string | undefined;
  headers: Record<string, string>;
  body: string | undefined;
}
interface CachedEventHandlerOptions extends Omit<CacheOptions$1<ResponseCacheEntry, [HTTPEvent]>, "transform" | "validate"> {
  headersOnly?: boolean;
  varies?: string[] | readonly string[];
} //#endregion
//#region src/types/runtime/nitro.d.ts
interface NitroApp {
  fetch: (req: Request) => Response | Promise<Response>;
  h3?: H3Core;
  hooks?: HookableCore<NitroRuntimeHooks>;
  captureError?: CaptureError;
}
interface CapturedErrorContext {
  event?: HTTPEvent;
  tags?: string[];
}
type CaptureError = (error: Error, context: CapturedErrorContext) => void;
interface NitroRuntimeHooks {
  close: () => void;
  error: CaptureError;
  request: (event: HTTPEvent) => void | Promise<void>;
  response: (res: Response, event: HTTPEvent) => void | Promise<void>;
} //#endregion
//#region src/types/runtime/task.d.ts
//#endregion
//#region src/presets/aws-amplify/types.d.ts
type AmplifyImageSettings = {
  /** Array of supported image widths */sizes: number[];
  /**
   * Array of allowed external domains that can use Image Optimization.
   * Leave empty for only allowing the deployment domain to use Image Optimization.
   */
  domains: string[];
  /**
   * Array of allowed external patterns that can use Image Optimization.
   * Similar to `domains` but provides more control with RegExp.
   */
  remotePatterns: {
    /** The protocol of the allowed remote pattern. Can be `http` or `https`. */protocol?: "http" | "https";
    /**
     * The hostname of the allowed remote pattern.
     * Can be literal or wildcard. Single `*` matches a single subdomain.
     *  Double `**` matches any number of subdomains.
     * We will disallow blanket wildcards of `**` with nothing else.
     */
    hostname: string; /** The port of the allowed remote pattern. */
    port?: string; /** The pathname of the allowed remote pattern. */
    pathname?: string;
  }[]; /** Array of allowed output image formats. */
  formats: ("image/avif" | "image/webp" | "image/gif" | "image/png" | "image/jpeg")[]; /** Cache duration (in seconds) for the optimized images. */
  minimumCacheTTL: number; /** Allow SVG input image URLs. This is disabled by default for security purposes. */
  dangerouslyAllowSVG: boolean;
};
interface AWSAmplifyOptions {
  catchAllStaticFallback?: boolean;
  imageOptimization?: {
    path?: string;
    cacheControl?: string;
  };
  imageSettings?: AmplifyImageSettings;
  runtime?: "nodejs20.x" | "nodejs22.x";
} //#endregion
//#region src/presets/aws-lambda/types.d.ts
interface AwsLambdaOptions {
  streaming?: boolean;
} //#endregion
//#region src/presets/azure/types.d.ts
interface AzureOptions {
  config?: {
    platform?: {
      apiRuntime?: string;
      [key: string]: unknown;
    };
    navigationFallback?: {
      rewrite?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
} //#endregion
//#region src/presets/cloudflare/wrangler/environment.d.ts
/**
 * Copyright (c) 2020 Cloudflare, Inc. <wrangler@cloudflare.com>
 * https://github.com/cloudflare/workers-sdk/blob/main/LICENSE-MIT
 * https://github.com/cloudflare/workers-sdk/blob/main/LICENSE-APACHE
 *
 * Source: https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/config/environment.ts
 */
/**
 * The `Environment` interface declares all the configuration fields that
 * can be specified for an environment.
 *
 * This could be the top-level default environment, or a specific named environment.
 */
interface Environment extends EnvironmentInheritable, EnvironmentNonInheritable {}
type SimpleRoute = string;
type ZoneIdRoute = {
  pattern: string;
  zone_id: string;
  custom_domain?: boolean;
};
type ZoneNameRoute = {
  pattern: string;
  zone_name: string;
  custom_domain?: boolean;
};
type CustomDomainRoute = {
  pattern: string;
  custom_domain: boolean;
};
type Route$1 = SimpleRoute | ZoneIdRoute | ZoneNameRoute | CustomDomainRoute;
/**
 * Configuration in wrangler for Cloudchamber
 */
type CloudchamberConfig = {
  image?: string;
  location?: string;
  instance_type?: "dev" | "basic" | "standard";
  vcpu?: number;
  memory?: string;
  ipv4?: boolean;
};
/**
 * Configuration for a container application
 */
type ContainerApp = {
  /**
   * Name of the application
   * @optional Defaults to `worker_name-class_name` if not specified.
   */
  name?: string;
  /**
   * Number of application instances
   * @deprecated
   * @hidden
   */
  instances?: number;
  /**
   * Number of maximum application instances.
   * @optional
   */
  max_instances?: number;
  /**
   * The path to a Dockerfile, or an image URI for the Cloudflare registry.
   */
  image: string;
  /**
   * Build context of the application.
   * @optional - defaults to the directory of `image`.
   */
  image_build_context?: string;
  /**
   * Image variables to be passed along the image at build time.
   * @optional
   */
  image_vars?: Record<string, string>;
  /**
   * The class name of the Durable Object the container is connected to.
   */
  class_name: string;
  /**
   * The scheduling policy of the application
   * @optional
   * @default "default"
   */
  scheduling_policy?: "regional" | "moon" | "default";
  /**
   * The instance type to be used for the container. This sets preconfigured options for vcpu and memory
   * @optional
   */
  instance_type?: "dev" | "basic" | "standard";
  /**
   * @deprecated Use top level `containers` fields instead.
   * `configuration.image` should be `image`
   * `configuration.disk` should be set via `instance_type`
   * @hidden
   */
  configuration?: {
    image?: string;
    labels?: {
      name: string;
      value: string;
    }[];
    secrets?: {
      name: string;
      type: "env";
      secret: string;
    }[];
    disk?: {
      size: string;
    };
  };
  /**
   * Scheduling constraints
   * @hidden
   */
  constraints?: {
    regions?: string[];
    cities?: string[];
    tier?: number;
  };
  /**
   * @deprecated use the `class_name` field instead.
   * @hidden
   */
  durable_objects?: {
    namespace_id: string;
  };
  /**
   * How a rollout should be done, defining the size of it
   * @optional
   * @default 25
   * */
  rollout_step_percentage?: number;
  /**
   * How a rollout should be created. It supports the following modes:
   *  - full_auto: The container application will be rolled out fully automatically.
   *  - none: The container application won't have a roll out or update.
   *  - manual: The container application will be rollout fully by manually actioning progress steps.
   * @optional
   * @default "full_auto"
   */
  rollout_kind?: "full_auto" | "none" | "full_manual";
};
/**
 * Configuration in wrangler for Durable Object Migrations
 */
type DurableObjectMigration = {
  /** A unique identifier for this migration. */tag: string; /** The new Durable Objects being defined. */
  new_classes?: string[]; /** The new SQLite Durable Objects being defined. */
  new_sqlite_classes?: string[]; /** The Durable Objects being renamed. */
  renamed_classes?: {
    from: string;
    to: string;
  }[]; /** The Durable Objects being removed. */
  deleted_classes?: string[];
};
/**
 * The `EnvironmentInheritable` interface declares all the configuration fields for an environment
 * that can be inherited (and overridden) from the top-level environment.
 */
interface EnvironmentInheritable {
  /**
   * The name of your Worker. Alphanumeric + dashes only.
   *
   * @inheritable
   */
  name: string | undefined;
  /**
   * This is the ID of the account associated with your zone.
   * You might have more than one account, so make sure to use
   * the ID of the account associated with the zone/route you
   * provide, if you provide one. It can also be specified through
   * the CLOUDFLARE_ACCOUNT_ID environment variable.
   *
   * @inheritable
   */
  account_id: string | undefined;
  /**
   * A date in the form yyyy-mm-dd, which will be used to determine
   * which version of the Workers runtime is used.
   *
   * More details at https://developers.cloudflare.com/workers/configuration/compatibility-dates
   *
   * @inheritable
   */
  compatibility_date: string | undefined;
  /**
   * A list of flags that enable features from upcoming features of
   * the Workers runtime, usually used together with compatibility_date.
   *
   * More details at https://developers.cloudflare.com/workers/configuration/compatibility-flags/
   *
   * @default []
   * @inheritable
   */
  compatibility_flags: string[];
  /**
   * The entrypoint/path to the JavaScript file that will be executed.
   *
   * @inheritable
   */
  main: string | undefined;
  /**
   * If true then Wrangler will traverse the file tree below `base_dir`;
   * Any files that match `rules` will be included in the deployed Worker.
   * Defaults to true if `no_bundle` is true, otherwise false.
   *
   * @inheritable
   */
  find_additional_modules: boolean | undefined;
  /**
   * Determines whether Wrangler will preserve bundled file names.
   * Defaults to false.
   * If left unset, files will be named using the pattern ${fileHash}-${basename},
   * for example, `34de60b44167af5c5a709e62a4e20c4f18c9e3b6-favicon.ico`.
   *
   * @inheritable
   */
  preserve_file_names: boolean | undefined;
  /**
   * The directory in which module rules should be evaluated when including additional files into a Worker deployment.
   * This defaults to the directory containing the `main` entry point of the Worker if not specified.
   *
   * @inheritable
   */
  base_dir: string | undefined;
  /**
   * Whether we use <name>.<subdomain>.workers.dev to
   * test and deploy your Worker.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#workersdev
   *
   * @default true
   * @breaking
   * @inheritable
   */
  workers_dev: boolean | undefined;
  /**
   * Whether we use <version>-<name>.<subdomain>.workers.dev to
   * serve Preview URLs for your Worker.
   *
   * @default true
   * @inheritable
   */
  preview_urls: boolean | undefined;
  /**
   * A list of routes that your Worker should be published to.
   * Only one of `routes` or `route` is required.
   *
   * Only required when workers_dev is false, and there's no scheduled Worker (see `triggers`)
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#types-of-routes
   *
   * @inheritable
   */
  routes: Route$1[] | undefined;
  /**
   * A route that your Worker should be published to. Literally
   * the same as routes, but only one.
   * Only one of `routes` or `route` is required.
   *
   * Only required when workers_dev is false, and there's no scheduled Worker
   *
   * @inheritable
   */
  route: Route$1 | undefined;
  /**
   * Path to a custom tsconfig
   *
   * @inheritable
   */
  tsconfig: string | undefined;
  /**
   * The function to use to replace jsx syntax.
   *
   * @default "React.createElement"
   * @inheritable
   */
  jsx_factory: string;
  /**
   * The function to use to replace jsx fragment syntax.
   *
   * @default "React.Fragment"
   * @inheritable
   */
  jsx_fragment: string;
  /**
   * A list of migrations that should be uploaded with your Worker.
   *
   * These define changes in your Durable Object declarations.
   *
   * More details at https://developers.cloudflare.com/workers/learning/using-durable-objects#configuring-durable-object-classes-with-migrations
   *
   * @default []
   * @inheritable
   */
  migrations: DurableObjectMigration[];
  /**
   * "Cron" definitions to trigger a Worker's "scheduled" function.
   *
   * Lets you call Workers periodically, much like a cron job.
   *
   * More details here https://developers.cloudflare.com/workers/platform/cron-triggers
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#triggers
   *
   * @default {crons: undefined}
   * @inheritable
   */
  triggers: {
    crons: string[] | undefined;
  };
  /**
   * Specify limits for runtime behavior.
   * Only supported for the "standard" Usage Model
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#limits
   *
   * @inheritable
   */
  limits: UserLimits | undefined;
  /**
   * An ordered list of rules that define which modules to import,
   * and what type to import them as. You will need to specify rules
   * to use Text, Data, and CompiledWasm modules, or when you wish to
   * have a .js file be treated as an ESModule instead of CommonJS.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#bundling
   *
   * @inheritable
   */
  rules: Rule[];
  /**
   * Configures a custom build step to be run by Wrangler when building your Worker.
   *
   * Refer to the [custom builds documentation](https://developers.cloudflare.com/workers/cli-wrangler/configuration#build)
   * for more details.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#custom-builds
   *
   * @default {watch_dir:"./src"}
   */
  build: {
    /** The command used to build your Worker. On Linux and macOS, the command is executed in the `sh` shell and the `cmd` shell for Windows. The `&&` and `||` shell operators may be used. */command?: string; /** The directory in which the command is executed. */
    cwd?: string; /** The directory to watch for changes while using wrangler dev, defaults to the current working directory */
    watch_dir?: string | string[];
  };
  /**
   * Skip internal build steps and directly deploy script
   * @inheritable
   */
  no_bundle: boolean | undefined;
  /**
   * Minify the script before uploading.
   * @inheritable
   */
  minify: boolean | undefined;
  /**
   * Set the `name` property to the original name for functions and classes renamed during minification.
   *
   * See https://esbuild.github.io/api/#keep-names
   *
   * @default true
   * @inheritable
   */
  keep_names: boolean | undefined;
  /**
   * Designates this Worker as an internal-only "first-party" Worker.
   *
   * @inheritable
   */
  first_party_worker: boolean | undefined;
  /**
   * List of bindings that you will send to logfwdr
   *
   * @default {bindings:[]}
   * @inheritable
   */
  logfwdr: {
    bindings: {
      /** The binding name used to refer to logfwdr */name: string; /** The destination for this logged message */
      destination: string;
    }[];
  };
  /**
   * Send Trace Events from this Worker to Workers Logpush.
   *
   * This will not configure a corresponding Logpush job automatically.
   *
   * For more information about Workers Logpush, see:
   * https://blog.cloudflare.com/logpush-for-workers/
   *
   * @inheritable
   */
  logpush: boolean | undefined;
  /**
   * Include source maps when uploading this worker.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#source-maps
   *
   * @inheritable
   */
  upload_source_maps: boolean | undefined;
  /**
   * Specify how the Worker should be located to minimize round-trip time.
   *
   * More details: https://developers.cloudflare.com/workers/platform/smart-placement/
   *
   * @inheritable
   */
  placement: {
    mode: "off" | "smart";
    hint?: string;
  } | undefined;
  /**
   * Specify the directory of static assets to deploy/serve
   *
   * More details at https://developers.cloudflare.com/workers/frameworks/
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#assets
   *
   * @inheritable
   */
  assets: Assets | undefined;
  /**
   * Specify the observability behavior of the Worker.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#observability
   *
   * @inheritable
   */
  observability: Observability | undefined;
  /**
   * Specify the compliance region mode of the Worker.
   *
   * Although if the user does not specify a compliance region, the default is `public`,
   * it can be set to `undefined` in configuration to delegate to the CLOUDFLARE_COMPLIANCE_REGION environment variable.
   */
  compliance_region: "public" | "fedramp_high" | undefined;
}
type DurableObjectBindings = {
  /** The name of the binding used to refer to the Durable Object */name: string; /** The exported class name of the Durable Object */
  class_name: string; /** The script where the Durable Object is defined (if it's external to this Worker) */
  script_name?: string; /** The service environment of the script_name to bind to */
  environment?: string;
}[];
type WorkflowBinding = {
  /** The name of the binding used to refer to the Workflow */binding: string; /** The name of the Workflow */
  name: string; /** The exported class name of the Workflow */
  class_name: string; /** The script where the Workflow is defined (if it's external to this Worker) */
  script_name?: string; /** Whether the Workflow should be remote or not (only available under `--x-remote-bindings`) */
  experimental_remote?: boolean;
};
/**
 * The `EnvironmentNonInheritable` interface declares all the configuration fields for an environment
 * that cannot be inherited from the top-level environment, and must be defined specifically.
 *
 * If any of these fields are defined at the top-level then they should also be specifically defined
 * for each named environment.
 */
interface EnvironmentNonInheritable {
  /**
   * A map of values to substitute when deploying your Worker.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * @default {}
   * @nonInheritable
   */
  define: Record<string, string>;
  /**
   * A map of environment variables to set when deploying your Worker.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#environment-variables
   *
   * @default {}
   * @nonInheritable
   */
  vars: Record<string, unknown>;
  /**
   * A list of durable objects that your Worker should be bound to.
   *
   * For more information about Durable Objects, see the documentation at
   * https://developers.cloudflare.com/workers/learning/using-durable-objects
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#durable-objects
   *
   * @default {bindings:[]}
   * @nonInheritable
   */
  durable_objects: {
    bindings: DurableObjectBindings;
  };
  /**
   * A list of workflows that your Worker should be bound to.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * @default []
   * @nonInheritable
   */
  workflows: WorkflowBinding[];
  /**
   * Cloudchamber configuration
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * @default {}
   * @nonInheritable
   */
  cloudchamber: CloudchamberConfig;
  /**
   * Container related configuration
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * @default []
   * @nonInheritable
   */
  containers?: ContainerApp[];
  /**
   * These specify any Workers KV Namespaces you want to
   * access from inside your Worker.
   *
   * To learn more about KV Namespaces,
   * see the documentation at https://developers.cloudflare.com/workers/learning/how-kv-works
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#kv-namespaces
   *
   * @default []
   * @nonInheritable
   */
  kv_namespaces: {
    /** The binding name used to refer to the KV Namespace */binding: string; /** The ID of the KV namespace */
    id?: string; /** The ID of the KV namespace used during `wrangler dev` */
    preview_id?: string; /** Whether the KV namespace should be remote or not (only available under `--x-remote-bindings`) */
    experimental_remote?: boolean;
  }[];
  /**
   * These specify bindings to send email from inside your Worker.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#email-bindings
   *
   * @default []
   * @nonInheritable
   */
  send_email: {
    /** The binding name used to refer to the this binding */name: string; /** If this binding should be restricted to a specific verified address */
    destination_address?: string; /** If this binding should be restricted to a set of verified addresses */
    allowed_destination_addresses?: string[];
  }[];
  /**
   * Specifies Queues that are bound to this Worker environment.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#queues
   *
   * @default {consumers:[],producers:[]}
   * @nonInheritable
   */
  queues: {
    /** Producer bindings */producers?: {
      /** The binding name used to refer to the Queue in the Worker. */binding: string; /** The name of this Queue. */
      queue: string; /** The number of seconds to wait before delivering a message */
      delivery_delay?: number; /** Whether the Queue producer should be remote or not (only available under `--x-remote-bindings`) */
      experimental_remote?: boolean;
    }[]; /** Consumer configuration */
    consumers?: {
      /** The name of the queue from which this consumer should consume. */queue: string; /** The consumer type, e.g., worker, http-pull, r2-bucket, etc. Default is worker. */
      type?: string; /** The maximum number of messages per batch */
      max_batch_size?: number; /** The maximum number of seconds to wait to fill a batch with messages. */
      max_batch_timeout?: number; /** The maximum number of retries for each message. */
      max_retries?: number; /** The queue to send messages that failed to be consumed. */
      dead_letter_queue?: string; /** The maximum number of concurrent consumer Worker invocations. Leaving this unset will allow your consumer to scale to the maximum concurrency needed to keep up with the message backlog. */
      max_concurrency?: number | null; /** The number of milliseconds to wait for pulled messages to become visible again */
      visibility_timeout_ms?: number; /** The number of seconds to wait before retrying a message */
      retry_delay?: number;
    }[];
  };
  /**
   * Specifies R2 buckets that are bound to this Worker environment.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#r2-buckets
   *
   * @default []
   * @nonInheritable
   */
  r2_buckets: {
    /** The binding name used to refer to the R2 bucket in the Worker. */binding: string; /** The name of this R2 bucket at the edge. */
    bucket_name?: string; /** The preview name of this R2 bucket at the edge. */
    preview_bucket_name?: string; /** The jurisdiction that the bucket exists in. Default if not present. */
    jurisdiction?: string; /** Whether the R2 bucket should be remote or not (only available under `--x-remote-bindings`) */
    experimental_remote?: boolean;
  }[];
  /**
   * Specifies D1 databases that are bound to this Worker environment.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#d1-databases
   *
   * @default []
   * @nonInheritable
   */
  d1_databases: {
    /** The binding name used to refer to the D1 database in the Worker. */binding: string; /** The name of this D1 database. */
    database_name?: string; /** The UUID of this D1 database (not required). */
    database_id?: string; /** The UUID of this D1 database for Wrangler Dev (if specified). */
    preview_database_id?: string; /** The name of the migrations table for this D1 database (defaults to 'd1_migrations'). */
    migrations_table?: string; /** The path to the directory of migrations for this D1 database (defaults to './migrations'). */
    migrations_dir?: string; /** Internal use only. */
    database_internal_env?: string; /** Whether the D1 database should be remote or not (only available under `--x-remote-bindings`) */
    experimental_remote?: boolean;
  }[];
  /**
   * Specifies Vectorize indexes that are bound to this Worker environment.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#vectorize-indexes
   *
   * @default []
   * @nonInheritable
   */
  vectorize: {
    /** The binding name used to refer to the Vectorize index in the Worker. */binding: string; /** The name of the index. */
    index_name: string; /** Whether the Vectorize index should be remote or not (only available under `--x-remote-bindings`) */
    experimental_remote?: boolean;
  }[];
  /**
   * Specifies Hyperdrive configs that are bound to this Worker environment.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#hyperdrive
   *
   * @default []
   * @nonInheritable
   */
  hyperdrive: {
    /** The binding name used to refer to the project in the Worker. */binding: string; /** The id of the database. */
    id: string; /** The local database connection string for `wrangler dev` */
    localConnectionString?: string;
  }[];
  /**
   * Specifies service bindings (Worker-to-Worker) that are bound to this Worker environment.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#service-bindings
   *
   * @default []
   * @nonInheritable
   */
  services: {
    /** The binding name used to refer to the bound service. */binding: string; /** The name of the service. */
    service: string; /** The environment of the service (e.g. production, staging, etc). */
    environment?: string; /** Optionally, the entrypoint (named export) of the service to bind to. */
    entrypoint?: string; /** Optional properties that will be made available to the service via ctx.props. */
    props?: Record<string, unknown>; /** Whether the service binding should be remote or not (only available under `--x-remote-bindings`) */
    experimental_remote?: boolean;
  }[] | undefined;
  /**
   * Specifies analytics engine datasets that are bound to this Worker environment.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#analytics-engine-datasets
   *
   * @default []
   * @nonInheritable
   */
  analytics_engine_datasets: {
    /** The binding name used to refer to the dataset in the Worker. */binding: string; /** The name of this dataset to write to. */
    dataset?: string;
  }[];
  /**
   * A browser that will be usable from the Worker.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#browser-rendering
   *
   * @default {}
   * @nonInheritable
   */
  browser: {
    binding: string; /** Whether the Browser binding should be remote or not (only available under `--x-remote-bindings`) */
    experimental_remote?: boolean;
  } | undefined;
  /**
   * Binding to the AI project.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#workers-ai
   *
   * @default {}
   * @nonInheritable
   */
  ai: {
    binding: string;
    staging?: boolean; /** Whether the AI binding should be remote or not (only available under `--x-remote-bindings`) */
    experimental_remote?: boolean;
  } | undefined;
  /**
   * Binding to Cloudflare Images
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#images
   *
   * @default {}
   * @nonInheritable
   */
  images: {
    binding: string; /** Whether the Images binding should be remote or not (only available under `--x-remote-bindings`) */
    experimental_remote?: boolean;
  } | undefined;
  /**
   * Binding to the Worker Version's metadata
   */
  version_metadata: {
    binding: string;
  } | undefined;
  /**
   * "Unsafe" tables for features that aren't directly supported by wrangler.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * @default {}
   * @nonInheritable
   */
  unsafe: {
    /**
     * A set of bindings that should be put into a Worker's upload metadata without changes. These
     * can be used to implement bindings for features that haven't released and aren't supported
     * directly by wrangler or miniflare.
     */
    bindings?: {
      name: string;
      type: string;
      [key: string]: unknown;
    }[];
    /**
     * Arbitrary key/value pairs that will be included in the uploaded metadata.  Values specified
     * here will always be applied to metadata last, so can add new or override existing fields.
     */
    metadata?: {
      [key: string]: unknown;
    };
    /**
     * Used for internal capnp uploads for the Workers runtime
     */
    capnp?: {
      base_path: string;
      source_schemas: string[];
      compiled_schema?: never;
    } | {
      base_path?: never;
      source_schemas?: never;
      compiled_schema: string;
    };
  };
  /**
   * Specifies a list of mTLS certificates that are bound to this Worker environment.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#mtls-certificates
   *
   * @default []
   * @nonInheritable
   */
  mtls_certificates: {
    /** The binding name used to refer to the certificate in the Worker */binding: string; /** The uuid of the uploaded mTLS certificate */
    certificate_id: string; /** Whether the mtls fetcher should be remote or not (only available under `--x-remote-bindings`) */
    experimental_remote?: boolean;
  }[];
  /**
   * Specifies a list of Tail Workers that are bound to this Worker environment
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * @default []
   * @nonInheritable
   */
  tail_consumers?: TailConsumer[];
  /**
   * Specifies namespace bindings that are bound to this Worker environment.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * For reference, see https://developers.cloudflare.com/workers/wrangler/configuration/#dispatch-namespace-bindings-workers-for-platforms
   *
   * @default []
   * @nonInheritable
   */
  dispatch_namespaces: {
    /** The binding name used to refer to the bound service. */binding: string; /** The namespace to bind to. */
    namespace: string; /** Details about the outbound Worker which will handle outbound requests from your namespace */
    outbound?: DispatchNamespaceOutbound; /** Whether the Dispatch Namespace should be remote or not (only available under `--x-remote-bindings`) */
    experimental_remote?: boolean;
  }[];
  /**
   * Specifies list of Pipelines bound to this Worker environment
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * @default []
   * @nonInheritable
   */
  pipelines: {
    /** The binding name used to refer to the bound service. */binding: string; /** Name of the Pipeline to bind */
    pipeline: string;
  }[];
  /**
   * Specifies Secret Store bindings that are bound to this Worker environment.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * @default []
   * @nonInheritable
   */
  secrets_store_secrets: {
    /** The binding name used to refer to the bound service. */binding: string; /** Id of the secret store */
    store_id: string; /** Name of the secret */
    secret_name: string;
  }[];
  /**
   * **DO NOT USE**. Hello World Binding Config to serve as an explanatory example.
   *
   * NOTE: This field is not automatically inherited from the top level environment,
   * and so must be specified in every named environment.
   *
   * @default []
   * @nonInheritable
   */
  unsafe_hello_world: {
    /** The binding name used to refer to the bound service. */binding: string; /** Whether the timer is enabled */
    enable_timer?: boolean;
  }[];
}
/**
 * A bundling resolver rule, defining the modules type for paths that match the specified globs.
 */
type Rule = {
  type: ConfigModuleRuleType;
  globs: string[];
  fallthrough?: boolean;
};
/**
 * The possible types for a `Rule`.
 */
type ConfigModuleRuleType = "ESModule" | "CommonJS" | "CompiledWasm" | "Text" | "Data" | "PythonModule" | "PythonRequirement";
type TailConsumer = {
  /** The name of the service tail events will be forwarded to. */service: string; /** (Optional) The environment of the service. */
  environment?: string;
};
interface DispatchNamespaceOutbound {
  /** Name of the service handling the outbound requests */
  service: string;
  /** (Optional) Name of the environment handling the outbound requests. */
  environment?: string;
  /** (Optional) List of parameter names, for sending context from your dispatch Worker to the outbound handler */
  parameters?: string[];
}
interface UserLimits {
  /** Maximum allowed CPU time for a Worker's invocation in milliseconds */
  cpu_ms: number;
}
type Assets = {
  /** Absolute path to assets directory */directory?: string; /** Name of `env` binding property in the User Worker. */
  binding?: string; /** How to handle HTML requests. */
  html_handling?: "auto-trailing-slash" | "force-trailing-slash" | "drop-trailing-slash" | "none"; /** How to handle requests that do not match an asset. */
  not_found_handling?: "single-page-application" | "404-page" | "none";
  /**
   * Matches will be routed to the User Worker, and matches to negative rules will go to the Asset Worker.
   *
   * Can also be `true`, indicating that every request should be routed to the User Worker.
   */
  run_worker_first?: string[] | boolean;
};
interface Observability {
  /** If observability is enabled for this Worker */
  enabled?: boolean;
  /** The sampling rate */
  head_sampling_rate?: number;
  logs?: {
    enabled?: boolean; /** The sampling rate */
    head_sampling_rate?: number; /** Set to false to disable invocation logs */
    invocation_logs?: boolean;
  };
} //#endregion
//#region src/presets/cloudflare/wrangler/config.d.ts
/**
 * This is the static type definition for the configuration object.
 *
 * It reflects a normalized and validated version of the configuration that you can write in a Wrangler configuration file,
 * and optionally augment with arguments passed directly to wrangler.
 *
 * For more information about the configuration object, see the
 * documentation at https://developers.cloudflare.com/workers/cli-wrangler/configuration
 *
 * Notes:
 *
 * - Fields that are only specified in `ConfigFields` and not `Environment` can only appear
 * in the top level config and should not appear in any environments.
 * - Fields that are specified in `PagesConfigFields` are only relevant for Pages projects
 * - All top level fields in config and environments are optional in the Wrangler configuration file.
 *
 * Legend for the annotations:
 *
 * - `@breaking`: the deprecation/optionality is a breaking change from Wrangler v1.
 * - `@todo`: there's more work to be done (with details attached).
 */
type Config = ComputedFields & ConfigFields<DevConfig> & PagesConfigFields & Environment;
interface ComputedFields {
  /** The path to the Wrangler configuration file (if any, and possibly redirected from the user Wrangler configuration) used to create this configuration. */
  configPath: string | undefined;
  /** The path to the user's Wrangler configuration file (if any), which may have been redirected to another file that used to create this configuration. */
  userConfigPath: string | undefined;
  /**
   * The original top level name for the Worker in the raw configuration.
   *
   * When a raw configuration has been flattened to a single environment the worker name may have been replaced or transformed.
   * It can be useful to know what the top-level name was before the flattening.
   */
  topLevelName: string | undefined;
}
interface ConfigFields<Dev extends RawDevConfig> {
  /**
   * A boolean to enable "legacy" style wrangler environments (from Wrangler v1).
   * These have been superseded by Services, but there may be projects that won't
   * (or can't) use them. If you're using a legacy environment, you can set this
   * to `true` to enable it.
   */
  legacy_env: boolean;
  /**
   * Whether Wrangler should send usage metrics to Cloudflare for this project.
   *
   * When defined this will override any user settings.
   * Otherwise, Wrangler will use the user's preference.
   */
  send_metrics: boolean | undefined;
  /**
   * Options to configure the development server that your worker will use.
   */
  dev: Dev;
  /**
   * The definition of a Worker Site, a feature that lets you upload
   * static assets with your Worker.
   *
   * More details at https://developers.cloudflare.com/workers/platform/sites
   */
  site: {
    /**
     * The directory containing your static assets.
     *
     * It must be a path relative to your Wrangler configuration file.
     * Example: bucket = "./public"
     *
     * If there is a `site` field then it must contain this `bucket` field.
     */
    bucket: string;
    /**
     * The location of your Worker script.
     *
     * @deprecated DO NOT use this (it's a holdover from Wrangler v1.x). Either use the top level `main` field, or pass the path to your entry file as a command line argument.
     * @breaking
     */
    "entry-point"?: string;
    /**
     * An exclusive list of .gitignore-style patterns that match file
     * or directory names from your bucket location. Only matched
     * items will be uploaded. Example: include = ["upload_dir"]
     *
     * @optional
     * @default []
     */
    include?: string[];
    /**
     * A list of .gitignore-style patterns that match files or
     * directories in your bucket that should be excluded from
     * uploads. Example: exclude = ["ignore_dir"]
     *
     * @optional
     * @default []
     */
    exclude?: string[];
  } | undefined;
  /**
   * Old behaviour of serving a folder of static assets with your Worker,
   * without any additional code.
   * This can either be a string, or an object with additional config
   * fields.
   * Will be deprecated in the near future in favor of `assets`.
   */
  legacy_assets: {
    bucket: string;
    include: string[];
    exclude: string[];
    browser_TTL: number | undefined;
    serve_single_page_app: boolean;
  } | string | undefined;
  /**
   * A list of wasm modules that your worker should be bound to. This is
   * the "legacy" way of binding to a wasm module. ES module workers should
   * do proper module imports.
   */
  wasm_modules: {
    [key: string]: string;
  } | undefined;
  /**
   * A list of text files that your worker should be bound to. This is
   * the "legacy" way of binding to a text file. ES module workers should
   * do proper module imports.
   */
  text_blobs: {
    [key: string]: string;
  } | undefined;
  /**
   * A list of data files that your worker should be bound to. This is
   * the "legacy" way of binding to a data file. ES module workers should
   * do proper module imports.
   */
  data_blobs: {
    [key: string]: string;
  } | undefined;
  /**
   * A map of module aliases. Lets you swap out a module for any others.
   * Corresponds with esbuild's `alias` config
   */
  alias: {
    [key: string]: string;
  } | undefined;
  /**
   * By default, the Wrangler configuration file is the source of truth for your environment configuration, like a terraform file.
   *
   * If you change your vars in the dashboard, wrangler *will* override/delete them on its next deploy.
   *
   * If you want to keep your dashboard vars when wrangler deploys, set this field to true.
   *
   * @default false
   * @nonInheritable
   */
  keep_vars?: boolean;
}
interface PagesConfigFields {
  /**
   * The directory of static assets to serve.
   *
   * The presence of this field in a Wrangler configuration file indicates a Pages project,
   * and will prompt the handling of the configuration file according to the
   * Pages-specific validation rules.
   */
  pages_build_output_dir?: string;
}
interface DevConfig {
  /**
   * IP address for the local dev server to listen on,
   *
   * @default localhost
   */
  ip: string;
  /**
   * Port for the local dev server to listen on
   *
   * @default 8787
   */
  port: number | undefined;
  /**
   * Port for the local dev server's inspector to listen on
   *
   * @default 9229
   */
  inspector_port: number | undefined;
  /**
   * Protocol that local wrangler dev server listens to requests on.
   *
   * @default http
   */
  local_protocol: "http" | "https";
  /**
   * Protocol that wrangler dev forwards requests on
   *
   * Setting this to `http` is not currently implemented for remote mode.
   * See https://github.com/cloudflare/workers-sdk/issues/583
   *
   * @default https
   */
  upstream_protocol: "https" | "http";
  /**
   * Host to forward requests to, defaults to the host of the first route of project
   */
  host: string | undefined;
}
type RawDevConfig = Partial<DevConfig>; //#endregion
//#region src/presets/cloudflare/types.d.ts
type WranglerConfig = Partial<Omit<Config, keyof ComputedFields>>;
/**
 * https://developers.cloudflare.com/pages/platform/functions/routing/#functions-invocation-routes
 */
interface CloudflarePagesRoutes {
  /** Defines the version of the schema. Currently there is only one version of the schema (version 1), however, we may add more in the future and aim to be backwards compatible. */
  version?: 1;
  /** Defines routes that will be invoked by Functions. Accepts wildcard behavior. */
  include?: string[];
  /** Defines routes that will not be invoked by Functions. Accepts wildcard behavior. `exclude` always take priority over `include`. */
  exclude?: string[];
}
interface CloudflareOptions {
  /**
   * Configuration for the Cloudflare Deployments.
   *
   * **NOTE:** This option is only effective if `deployConfig` is enabled.
   */
  wrangler?: WranglerConfig;
  /**
   * Enable automatic generation of `.wrangler/deploy/config.json`.
   *
   * **IMPORTANT:** Enabling this option will cause settings from cloudflare dashboard (including environment variables) to be disabled and discarded.
   *
   * More info: https://developers.cloudflare.com/workers/wrangler/configuration#generated-wrangler-configuration
   */
  deployConfig?: boolean;
  /**
   * Enable native Node.js compatibility support.
   *
   * If this option disabled, pure unenv polyfills will be used instead.
   *
   * If not set, will be auto enabled if `nodejs_compat` or `nodejs_compat_v2` is detected in `wrangler.toml` or `wrangler.json`.
   */
  nodeCompat?: boolean;
  /**
   * Options for dev emulation.
   */
  dev?: {
    configPath?: string;
    environment?: string;
    persistDir?: string;
  };
  pages?: {
    /**
     * Nitro will automatically generate a `_routes.json` that controls which files get served statically and
     * which get served by the Worker. Using this config will override the automatic `_routes.json`. Or, if the
     * `merge` options is set, it will merge the user-set routes with the auto-generated ones, giving priority
     * to the user routes.
     *
     * @see https://developers.cloudflare.com/pages/platform/functions/routing/#functions-invocation-routes
     *
     * There are a maximum of 100 rules, and you must have at least one include rule. Wildcards are accepted.
     *
     * If any fields are unset, they default to:
     *
     * ```json
     * {
     *   "version": 1,
     *   "include": ["/*"],
     *   "exclude": []
     * }
     * ```
     */
    routes?: CloudflarePagesRoutes;
    /**
     * If set to `false`, nitro will disable the automatically generated `_routes.json` and instead use the user-set only ones.
     *
     * @default true
     */
    defaultRoutes?: boolean;
  };
  /**
   * Custom Cloudflare exports additional classes such as WorkflowEntrypoint.
   */
  exports?: string;
}
type DurableObjectState = ConstructorParameters<typeof DurableObject>[0];
declare module "nitro/types" {
  interface NitroRuntimeHooks {
    "cloudflare:scheduled": (_: {
      controller: ScheduledController;
      env: unknown;
      context: ExecutionContext;
    }) => void;
    "cloudflare:email": (_: {
      message: ForwardableEmailMessage; /** @deprecated please use `message` */
      event: ForwardableEmailMessage;
      env: unknown;
      context: ExecutionContext;
    }) => void;
    "cloudflare:queue": (_: {
      batch: MessageBatch; /** @deprecated please use `batch` */
      event: MessageBatch;
      env: unknown;
      context: ExecutionContext;
    }) => void;
    "cloudflare:tail": (_: {
      traces: TraceItem[];
      env: unknown;
      context: ExecutionContext;
    }) => void;
    "cloudflare:trace": (_: {
      traces: TraceItem[];
      env: unknown;
      context: ExecutionContext;
    }) => void;
    "cloudflare:durable:init": (durable: DurableObject, _: {
      state: DurableObjectState;
      env: unknown;
    }) => void;
    "cloudflare:durable:alarm": (durable: DurableObject) => void;
  }
} //#endregion
//#region src/presets/firebase/types.d.ts
interface FirebaseOptions {
  appHosting: Partial<AppHostingOutputBundleConfig["runConfig"]>;
}
interface AppHostingOutputBundleConfig {
  version: "v1";
  runConfig: {
    /** Command to start the server (e.g. "node dist/index.js"). Assume this command is run from the root dir of the workspace. */runCommand: string; /** Environment variables set when the app is run. */
    environmentVariables?: Array<{
      /** Name of the variable. */variable: string; /** Value associated with the variable. */
      value: string; /** Where the variable will be available, for now only RUNTIME is supported. */
      availability: "RUNTIME"[];
    }>; /** The maximum number of concurrent requests that each server instance can receive. */
    concurrency?: number; /** The number of CPUs used in a single server instance. */
    cpu?: number; /** The amount of memory available for a server instance. */
    memoryMiB?: number; /** The limit on the minimum number of function instances that may coexist at a given time. */
    minInstances?: number; /** The limit on the maximum number of function instances that may coexist at a given time. */
    maxInstances?: number;
  };
  metadata: {
    adapterPackageName: string;
    adapterVersion: string;
    framework: string;
    frameworkVersion?: string;
  };
  outputFiles?: {
    /** serverApp holds a list of directories + files relative to the app root dir that frameworks need to deploy to the App Hosting server. */serverApp: {
      include: string[];
    };
  };
} //#endregion
//#region src/presets/netlify/types.d.ts
interface NetlifyOptions {
  /** @deprecated Use `config.images` */
  images?: NetlifyImagesConfig;
  config?: NetlifyConfigJson;
}
interface NetlifyConfigJson {
  edge_functions?: NetlifyEdgeFunctionDeclaration[];
  functions?: NetlifyFunctionsConfig | NetlifyFunctionsConfigByPattern;
  headers?: NetlifyHeaderRule[];
  images?: NetlifyImagesConfig;
  redirects?: NetlifyRedirectRule[];
  "redirects!"?: NetlifyRedirectRule[];
}
interface NetlifyEdgeFunctionDeclaration {
  function: string;
  path?: string;
  pattern?: string;
  excludedPath?: string;
  excludedPattern?: string;
  cache?: string;
  [key: string]: unknown;
}
interface NetlifyFunctionsConfig extends NetlifyFunctionInlineConfig {
  directory?: string;
}
type NetlifyFunctionsConfigByPattern = Record<string, NetlifyFunctionInlineConfig>;
interface NetlifyFunctionInlineConfig {
  included_files?: string[];
  [key: string]: unknown;
}
interface NetlifyHeaderRule {
  for: string;
  values: Record<string, string>;
  [key: string]: unknown;
}
interface NetlifyImagesConfig {
  remote_images?: string[];
  [key: string]: unknown;
}
interface NetlifyRedirectRule {
  from: string;
  to: string;
  status?: number;
  force?: boolean;
  conditions?: Record<string, string[]>;
  query?: Record<string, string>;
  [key: string]: unknown;
} //#endregion
//#region src/presets/vercel/types.d.ts
/**
 * Vercel Build Output Configuration
 * @see https://vercel.com/docs/build-output-api/v3
 */
interface VercelBuildConfigV3 {
  version: 3;
  routes?: ({
    src: string;
    headers: {
      "cache-control": string;
    };
    continue: boolean;
  } | {
    handle: string;
  } | {
    src: string;
    dest: string;
  })[];
  images?: {
    sizes: number[];
    domains: string[];
    remotePatterns?: {
      protocol?: "http" | "https";
      hostname: string;
      port?: string;
      pathname?: string;
    }[];
    minimumCacheTTL?: number;
    formats?: ("image/avif" | "image/webp")[];
    dangerouslyAllowSVG?: boolean;
    contentSecurityPolicy?: string;
  };
  wildcard?: Array<{
    domain: string;
    value: string;
  }>;
  overrides?: Record<string, {
    path?: string;
    contentType?: string;
  }>;
  cache?: string[];
  bypassToken?: string;
  crons?: {
    path: string;
    schedule: string;
  }[];
}
/**
 * https://vercel.com/docs/build-output-api/primitives#serverless-function-configuration
 * https://vercel.com/docs/build-output-api/primitives#node.js-config
 */
interface VercelServerlessFunctionConfig {
  /**
   * Amount of memory (RAM in MB) that will be allocated to the Serverless Function.
   */
  memory?: number;
  /**
   * Specifies the instruction set "architecture" the Vercel Function supports.
   *
   * Either `x86_64` or `arm64`. The default value is `x86_64`
   */
  architecture?: "x86_64" | "arm64";
  /**
   * Maximum execution duration (in seconds) that will be allowed for the Serverless Function.
   */
  maxDuration?: number;
  /**
   * Map of additional environment variables that will be available to the Vercel Function,
   * in addition to the env vars specified in the Project Settings.
   */
  environment?: Record<string, string>;
  /**
   * List of Vercel Regions where the Vercel Function will be deployed to.
   */
  regions?: string[];
  /**
   * True if a custom runtime has support for Lambda runtime wrappers.
   */
  supportsWrapper?: boolean;
  /**
   * When true, the Serverless Function will stream the response to the client.
   */
  supportsResponseStreaming?: boolean;
  /**
   * Enables source map generation.
   */
  shouldAddSourcemapSupport?: boolean;
  /**
   * The runtime to use. Defaults to the auto-detected Node.js version.
   */
  runtime?: "nodejs20.x" | "nodejs22.x" | "bun1.x" | (string & {});
  [key: string]: unknown;
}
interface VercelOptions {
  config?: VercelBuildConfigV3;
  /**
   * If you have enabled skew protection in the Vercel dashboard, it will
   * be enabled by default.
   *
   * You can disable the Nitro integration by setting this option to `false`.
   */
  skewProtection?: boolean;
  /**
   * If you are using `vercel-edge`, you can specify the region(s) for your edge function.
   * @see https://vercel.com/docs/concepts/functions/edge-functions#edge-function-regions
   */
  regions?: string[];
  functions?: VercelServerlessFunctionConfig;
  /**
   * Handler format to use for Vercel Serverless Functions.
   *
   * Using `node` format enables compatibility with Node.js specific APIs in your Nitro application (e.g., `req.runtime.node`).
   *
   * Possible values are: `web` (default) and `node`.
   */
  entryFormat?: "web" | "node";
} //#endregion
//#region src/presets/_types.gen.d.ts
interface PresetOptions {
  awsAmplify?: AWSAmplifyOptions;
  awsLambda?: AwsLambdaOptions;
  azure?: AzureOptions;
  cloudflare?: CloudflareOptions;
  firebase?: FirebaseOptions;
  netlify?: NetlifyOptions;
  vercel?: VercelOptions;
}
type PresetName = "alwaysdata" | "aws-amplify" | "aws-lambda" | "azure-swa" | "base-worker" | "bun" | "cleavr" | "cloudflare-dev" | "cloudflare-durable" | "cloudflare-module" | "cloudflare-pages" | "cloudflare-pages-static" | "deno" | "deno-deploy" | "deno-server" | "digital-ocean" | "firebase-app-hosting" | "flight-control" | "genezio" | "github-pages" | "gitlab-pages" | "heroku" | "iis-handler" | "iis-node" | "koyeb" | "netlify" | "netlify-edge" | "netlify-static" | "nitro-dev" | "nitro-prerender" | "node" | "node-cluster" | "node-middleware" | "node-server" | "platform-sh" | "render-com" | "standard" | "static" | "stormkit" | "vercel" | "vercel-static" | "winterjs" | "zeabur" | "zeabur-static" | "zerops" | "zerops-static";
type PresetNameInput = "alwaysdata" | "aws-amplify" | "awsAmplify" | "aws_amplify" | "aws-lambda" | "awsLambda" | "aws_lambda" | "azure-swa" | "azureSwa" | "azure_swa" | "base-worker" | "baseWorker" | "base_worker" | "bun" | "cleavr" | "cloudflare-dev" | "cloudflareDev" | "cloudflare_dev" | "cloudflare-durable" | "cloudflareDurable" | "cloudflare_durable" | "cloudflare-module" | "cloudflareModule" | "cloudflare_module" | "cloudflare-pages" | "cloudflarePages" | "cloudflare_pages" | "cloudflare-pages-static" | "cloudflarePagesStatic" | "cloudflare_pages_static" | "deno" | "deno-deploy" | "denoDeploy" | "deno_deploy" | "deno-server" | "denoServer" | "deno_server" | "digital-ocean" | "digitalOcean" | "digital_ocean" | "firebase-app-hosting" | "firebaseAppHosting" | "firebase_app_hosting" | "flight-control" | "flightControl" | "flight_control" | "genezio" | "github-pages" | "githubPages" | "github_pages" | "gitlab-pages" | "gitlabPages" | "gitlab_pages" | "heroku" | "iis-handler" | "iisHandler" | "iis_handler" | "iis-node" | "iisNode" | "iis_node" | "koyeb" | "netlify" | "netlify-edge" | "netlifyEdge" | "netlify_edge" | "netlify-static" | "netlifyStatic" | "netlify_static" | "nitro-dev" | "nitroDev" | "nitro_dev" | "nitro-prerender" | "nitroPrerender" | "nitro_prerender" | "node" | "node-cluster" | "nodeCluster" | "node_cluster" | "node-middleware" | "nodeMiddleware" | "node_middleware" | "node-server" | "nodeServer" | "node_server" | "platform-sh" | "platformSh" | "platform_sh" | "render-com" | "renderCom" | "render_com" | "standard" | "static" | "stormkit" | "vercel" | "vercel-static" | "vercelStatic" | "vercel_static" | "winterjs" | "zeabur" | "zeabur-static" | "zeaburStatic" | "zeabur_static" | "zerops" | "zerops-static" | "zeropsStatic" | "zerops_static" | (string & {}); //#endregion
//#region src/types/openapi-ts.d.ts
/**
Source: (inlined because of install size concernes)

https://github.com/openapi-ts/openapi-typescript/blob/fc3f7/packages/openapi-typescript/src/types.ts

MIT License

Copyright (c) 2020 Drew Powers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */
interface Extensable {
  [key: `x-${string}`]: any;
}
/**
 * [4.8] Schema
 * @see https://spec.openapis.org/oas/v3.1.0#schema
 */
interface OpenAPI3 extends Extensable {
  /** REQUIRED. This string MUST be the version number of the OpenAPI Specification that the OpenAPI document uses. The openapi field SHOULD be used by tooling to interpret the OpenAPI document. This is not related to the API info.version string. */
  openapi: string;
  /** REQUIRED. Provides metadata about the API. The metadata MAY be used by tooling as required. */
  info: InfoObject;
  /** The default value for the $schema keyword within Schema Objects contained within this OAS document. This MUST be in the form of a URI. */
  jsonSchemaDialect?: string;
  /** An array of Server Objects, which provide connectivity information to a target server. If the servers property is not provided, or is an empty array, the default value would be a Server Object with a url value of /. */
  servers?: ServerObject[];
  /** The available paths and operations for the API. */
  paths?: PathsObject;
  /** The incoming webhooks that MAY be received as part of this API and that the API consumer MAY choose to implement. Closely related to the callbacks feature, this section describes requests initiated other than by an API call, for example by an out of band registration. The key name is a unique string to refer to each webhook, while the (optionally referenced) Path Item Object describes a request that may be initiated by the API provider and the expected responses. An example is available. */
  webhooks?: {
    [id: string]: PathItemObject | ReferenceObject;
  };
  /** An element to hold various schemas for the document. */
  components?: ComponentsObject;
  /** A declaration of which security mechanisms can be used across the API. The list of values includes alternative security requirement objects that can be used. Only one of the security requirement objects need to be satisfied to authorize a request. Individual operations can override this definition. To make security optional, an empty security requirement ({}) can be included in the array. */
  security?: SecurityRequirementObject[];
  /** A list of tags used by the document with additional metadata. The order of the tags can be used to reflect on their order by the parsing tools. Not all tags that are used by the Operation Object must be declared. The tags that are not declared MAY be organized randomly or based on the tools’ logic. Each tag name in the list MUST be unique. */
  tags?: TagObject[];
  /** Additional external documentation. */
  externalDocs?: ExternalDocumentationObject;
  $defs?: $defs;
}
/**
 * [4.8.2] Info Object
 * The object provides metadata about the API.
 */
interface InfoObject extends Extensable {
  /** REQUIRED. The title of the API. */
  title: string;
  /** A short summary of the API. */
  summary?: string;
  /** A description of the API. CommonMark syntax MAY be used for rich text representation. */
  description?: string;
  /** A URL to the Terms of Service for the API. This MUST be in the form of a URL. */
  termsOfService?: string;
  /** The contact information for the exposed API. */
  contact?: ContactObject;
  /** The license information for the exposed API. */
  license?: LicenseObject;
  /** REQUIRED. The version of the OpenAPI document (which is distinct from the OpenAPI Specification version or the API implementation version). */
  version: string;
}
/**
 * [4.8.3] Contact Object
 * Contact information for the exposed API.
 */
interface ContactObject extends Extensable {
  /** The identifying name of the contact person/organization. */
  name?: string;
  /** The URL pointing to the contact information. This MUST be in the form of a URL. */
  url?: string;
  /** The email address of the contact person/organization. This MUST be in the form of an email address. */
  email?: string;
}
/**
 * [4.8.4] License object
 * License information for the exposed API.
 */
interface LicenseObject extends Extensable {
  /** REQUIRED. The license name used for the API. */
  name: string;
  /** An SPDX license expression for the API. The identifier field is mutually exclusive of the url field. */
  identifier: string;
  /** A URL to the license used for the API. This MUST be in the form of a URL. The url field is mutually exclusive of the identifier field. */
  url: string;
}
/**
 * [4.8.5] Server Object
 * An object representing a Server.
 */
interface ServerObject extends Extensable {
  /** REQUIRED. A URL to the target host. This URL supports Server Variables and MAY be relative, to indicate that the host location is relative to the location where the OpenAPI document is being served. Variable substitutions will be made when a variable is named in {brackets}. */
  url: string;
  /** An optional string describing the host designated by the URL. CommonMark syntax MAY be used for rich text representation. */
  description: string;
  /** A map between a variable name and its value. The value is used for substitution in the server’s URL template. */
  variables: {
    [name: string]: ServerVariableObject;
  };
}
/**
 * [4.8.6] Server Variable Object
 * An object representing a Server Variable for server URL template substitution.
 */
interface ServerVariableObject extends Extensable {
  /** An enumeration of string values to be used if the substitution options are from a limited set. The array MUST NOT be empty. */
  enum?: string[];
  /** REQUIRED. The default value to use for substitution, which SHALL be sent if an alternate value is not supplied. Note this behavior is different than the Schema Object’s treatment of default values, because in those cases parameter values are optional. If the enum is defined, the value MUST exist in the enum’s values. */
  default: string;
  /** An optional description for the server variable. CommonMark syntax MAY be used for rich text representation. */
  description?: string;
}
/**
 * [4.8.7] Components Object
 * Holds a set of reusable objects for different aspects of the OAS.
 */
interface ComponentsObject extends Extensable {
  /** An object to hold reusable Schema Objects.*/
  schemas?: Record<string, SchemaObject>;
  /** An object to hold reusable Response Objects. */
  responses?: Record<string, ResponseObject | ReferenceObject>;
  /** An object to hold reusable Parameter Objects. */
  parameters?: Record<string, ParameterObject | ReferenceObject>;
  /** An object to hold reusable Example Objects. */
  examples?: Record<string, ExampleObject | ReferenceObject>;
  /** An object to hold reusable Request Body Objects. */
  requestBodies?: Record<string, RequestBodyObject | ReferenceObject>;
  /** An object to hold reusable Header Objects. */
  headers?: Record<string, HeaderObject | ReferenceObject>;
  /** An object to hold reusable Security Scheme Objects. */
  securitySchemes?: Record<string, SecuritySchemeObject | ReferenceObject>;
  /** An object to hold reusable Link Objects. */
  links?: Record<string, LinkObject | ReferenceObject>;
  /** An object to hold reusable Callback Objects. */
  callbacks?: Record<string, CallbackObject | ReferenceObject>;
  /** An object to hold reusable Path Item Objects. */
  pathItems?: Record<string, PathItemObject | ReferenceObject>;
}
/**
 * [4.8.8] Paths Object
 * Holds the relative paths to the individual endpoints and their operations. The path is appended to the URL from the Server Object in order to construct the full URL. The Paths MAY be empty, due to Access Control List (ACL) constraints.
 */
interface PathsObject {
  [pathname: string]: PathItemObject | ReferenceObject;
}
/**
 * [4.8.9] Path Item Object
 * Describes the operations available on a single path. A Path Item MAY be empty, due to ACL constraints. The path itself is still exposed to the documentation viewer but they will not know which operations and parameters are available.
 */
interface PathItemObject extends Extensable {
  /** A definition of a GET operation on this path. */
  get?: OperationObject | ReferenceObject;
  /** A definition of a PUT operation on this path. */
  put?: OperationObject | ReferenceObject;
  /** A definition of a POST operation on this path. */
  post?: OperationObject | ReferenceObject;
  /** A definition of a DELETE operation on this path. */
  delete?: OperationObject | ReferenceObject;
  /** A definition of a OPTIONS operation on this path. */
  options?: OperationObject | ReferenceObject;
  /** A definition of a HEAD operation on this path. */
  head?: OperationObject | ReferenceObject;
  /** A definition of a PATCH operation on this path. */
  patch?: OperationObject | ReferenceObject;
  /** A definition of a TRACE operation on this path. */
  trace?: OperationObject | ReferenceObject;
  /** An alternative server array to service all operations in this path. */
  servers?: ServerObject[];
  /** A list of parameters that are applicable for all the operations described under this path. These parameters can be overridden at the operation level, but cannot be removed there. The list MUST NOT include duplicated parameters. A unique parameter is defined by a combination of a name and location. The list can use the Reference Object to link to parameters that are defined at the OpenAPI Object’s components/parameters. */
  parameters?: (ParameterObject | ReferenceObject)[];
}
/**
 * [4.8.10] Operation Object
 * Describes a single API operation on a path.
 */
interface OperationObject extends Extensable {
  /** A list of tags for API documentation control. Tags can be used for logical grouping of operations by resources or any other qualifier. */
  tags?: string[];
  /** A short summary of what the operation does. */
  summary?: string;
  /** A verbose explanation of the operation behavior. CommonMark syntax MAY be used for rich text representation. */
  description?: string;
  /** Additional external documentation for this operation. */
  externalDocs?: ExternalDocumentationObject;
  /** Unique string used to identify the operation. The id MUST be unique among all operations described in the API. The operationId value is case-sensitive. Tools and libraries MAY use the operationId to uniquely identify an operation, therefore, it is RECOMMENDED to follow common programming naming conventions. */
  operationId?: string;
  /** A list of parameters that are applicable for this operation. If a parameter is already defined at the Path Item, the new definition will override it but can never remove it. The list MUST NOT include duplicated parameters. A unique parameter is defined by a combination of a name and location. The list can use the Reference Object to link to parameters that are defined at the OpenAPI Object’s components/parameters. */
  parameters?: (ParameterObject | ReferenceObject)[];
  /** The request body applicable for this operation. The requestBody is fully supported in HTTP methods where the HTTP 1.1 specification [RFC7231] has explicitly defined semantics for request bodies. In other cases where the HTTP spec is vague (such as GET, HEAD and DELETE), requestBody is permitted but does not have well-defined semantics and SHOULD be avoided if possible. */
  requestBody?: RequestBodyObject | ReferenceObject;
  /** The list of possible responses as they are returned from executing this operation. */
  responses?: ResponsesObject;
  /** A map of possible out-of band callbacks related to the parent operation. The key is a unique identifier for the Callback Object. Each value in the map is a Callback Object that describes a request that may be initiated by the API provider and the expected responses. */
  callbacks?: Record<string, CallbackObject | ReferenceObject>;
  /** Declares this operation to be deprecated. Consumers SHOULD refrain from usage of the declared operation. Default value is false. */
  deprecated?: boolean;
  /** A declaration of which security mechanisms can be used for this operation. The list of values includes alternative security requirement objects that can be used. Only one of the security requirement objects need to be satisfied to authorize a request. To make security optional, an empty security requirement ({}) can be included in the array. This definition overrides any declared top-level security. To remove a top-level security declaration, an empty array can be used. */
  security?: SecurityRequirementObject[];
  /** An alternative server array to service this operation. If an alternative server object is specified at the Path Item Object or Root level, it will be overridden by this value. */
  servers?: ServerObject[];
}
/**
 * [4.8.11] External Documentation Object
 * Allows referencing an external resource for extended documentation.
 */
interface ExternalDocumentationObject extends Extensable {
  /** A description of the target documentation. CommonMark syntax MAY be used for rich text representation. */
  description?: string;
  /** REQUIRED. The URL for the target documentation. This MUST be in the form of a URL. */
  url: string;
}
/**
 * [4.8.12] Parameter Object
 * Describes a single operation parameter.
 * A unique parameter is defined by a combination of a name and location.
 */
interface ParameterObject extends Extensable {
  /**
   * REQUIRED. The name of the parameter. Parameter names are case sensitive.
   *
   * - If `in` is `"path"`, the `name` field MUST correspond to a template expression occurring within the path field in the Paths Object. See Path Templating for further information.
   * - If `in` is `"header"` and the `name` field is `"Accept"`, `"Content-Type"` or `"Authorization"`, the parameter definition SHALL be ignored.
   * - For all other cases, the `name` corresponds to the parameter name used by the `in` property.
   */
  name: string;
  /** REQUIRED. The location of the parameter. Possible values are "query", "header", "path" or "cookie".*/
  in: "query" | "header" | "path" | "cookie";
  /** A brief description of the parameter. This could contain examples of use. CommonMark syntax MAY be used for rich text representation. */
  description?: string;
  /** Determines whether this parameter is mandatory. If the parameter location is "path", this property is REQUIRED and its value MUST be true. Otherwise, the property MAY be included and its default value is false. */
  required?: boolean;
  /** Specifies that a parameter is deprecated and SHOULD be transitioned out of usage. Default value is false. */
  deprecated?: boolean;
  /** Sets the ability to pass empty-valued parameters. This is valid only for query parameters and allows sending a parameter with an empty value. Default value is false. If style is used, and if behavior is n/a (cannot be serialized), the value of allowEmptyValue SHALL be ignored. Use of this property is NOT RECOMMENDED, as it is likely to be removed in a later revision. */
  allowEmptyValue?: boolean;
  /** Describes how the parameter value will be serialized depending on the type of the parameter value. Default values (based on value of in): for query - form; for path - simple; for header - simple; for cookie - form. */
  style?: string;
  /** When this is true, parameter values of type `array` or `object` generate separate parameters for each value of the array or key-value pair of the map. For other types of parameters this property has no effect. When `style` is `form`, the default value is `true`. For all other styles, the default value is `false`. */
  explode?: boolean;
  /** Determines whether the parameter value SHOULD allow reserved characters, as defined by [RFC3986] `:/?#[]@!$&'()*+,;=` to be included without percent-encoding. This property only applies to parameters with an `in` value of `query`. The default value is `false`. */
  allowReserved?: boolean;
  /** The schema defining the type used for the parameter. */
  schema?: SchemaObject;
  /** Example of the parameter’s potential value. */
  example?: any;
  /** Examples of the parameter’s potential value. */
  examples?: {
    [name: string]: ExampleObject | ReferenceObject;
  };
  /** A map containing the representations for the parameter. */
  content?: {
    [contentType: string]: MediaTypeObject | ReferenceObject;
  };
}
/**
 * [4.8.13] Request Body Object
 * Describes a single request body.
 */
interface RequestBodyObject extends Extensable {
  /** A brief description of the request body. This could contain examples of use. CommonMark syntax MAY be used for rich text representation. */
  description?: string;
  /** REQUIRED. The content of the request body. The key is a media type or media type range and the value describes it. For requests that match multiple keys, only the most specific key is applicable. e.g. text/plain overrides text */
  content: {
    [contentType: string]: MediaTypeObject | ReferenceObject;
  };
  /** Determines if the request body is required in the request. Defaults to false. */
  required?: boolean;
}
/**
 * [4.8.14] Media Type Object
 */
interface MediaTypeObject extends Extensable {
  /** The schema defining the content of the request, response, or parameter. */
  schema?: SchemaObject | ReferenceObject;
  /** Example of the media type. The example object SHOULD be in the correct format as specified by the media type. The example field is mutually exclusive of the examples field. Furthermore, if referencing a schema which contains an example, the example value SHALL override the example provided by the schema. */
  example?: any;
  /** Examples of the media type. Each example object SHOULD match the media type and specified schema if present. The examples field is mutually exclusive of the example field. Furthermore, if referencing a schema which contains an example, the examples value SHALL override the example provided by the schema. */
  examples?: {
    [name: string]: ExampleObject | ReferenceObject;
  };
  /** A map between a property name and its encoding information. The key, being the property name, MUST exist in the schema as a property. The encoding object SHALL only apply to requestBody objects when the media type is multipart or application/x-www-form-urlencoded. */
  encoding?: {
    [propertyName: string]: EncodingObject;
  };
}
/**
 * [4.8.15] Encoding Object
 * A single encoding definition applied to a single schema property.
 */
interface EncodingObject extends Extensable {
  /** The Content-Type for encoding a specific property. Default value depends on the property type: for object - application/json; for array – the default is defined based on the inner type; for all other cases the default is application/octet-stream. The value can be a specific media type (e.g. application/json), a wildcard media type (e.g. image/*), or a comma-separated list of the two types. */
  contentType?: string;
  /** A map allowing additional information to be provided as headers, for example Content-Disposition. Content-Type is described separately and SHALL be ignored in this section. This property SHALL be ignored if the request body media type is not a multipart. */
  headers?: {
    [name: string]: HeaderObject | ReferenceObject;
  };
  /** Describes how a specific property value will be serialized depending on its type. See Parameter Object for details on the style property. The behavior follows the same values as query parameters, including default values. This property SHALL be ignored if the request body media type is not application/x-www-form-urlencoded or multipart/form-data. If a value is explicitly defined, then the value of contentType (implicit or explicit) SHALL be ignored. */
  style?: string;
  /** When this is true, property values of type array or object generate separate parameters for each value of the array, or key-value-pair of the map. For other types of properties this property has no effect. When style is form, the default value is true. For all other styles, the default value is false. This property SHALL be ignored if the request body media type is not application/x-www-form-urlencoded or multipart/form-data. If a value is explicitly defined, then the value of contentType (implicit or explicit) SHALL be ignored. */
  explode?: string;
  /** Determines whether the parameter value SHOULD allow reserved characters, as defined by [RFC3986] :/?#[]@!$&'()*+,;= to be included without percent-encoding. The default value is false. This property SHALL be ignored if the request body media type is not application/x-www-form-urlencoded or multipart/form-data. If a value is explicitly defined, then the value of contentType (implicit or explicit) SHALL be ignored. */
  allowReserved?: string;
}
/**
 * [4.8.16] Responses Object
 * A container for the expected responses of an operation. The container maps a HTTP response code to the expected response.
 */
type ResponsesObject = {
  [responseCode: string]: ResponseObject | ReferenceObject;
} & {
  /** The documentation of responses other than the ones declared for specific HTTP response codes. Use this field to cover undeclared responses. */default?: ResponseObject | ReferenceObject;
};
/**
 * [4.8.17] Response Object
 * Describes a single response from an API Operation, including design-time, static links to operations based on the response.
 */
interface ResponseObject extends Extensable {
  /** REQUIRED. A description of the response. CommonMark syntax MAY be used for rich text representation. */
  description: string;
  /** Maps a header name to its definition. [RFC7230] states header names are case insensitive. If a response header is defined with the name "Content-Type", it SHALL be ignored. */
  headers?: {
    [name: string]: HeaderObject | ReferenceObject;
  };
  /** A map containing descriptions of potential response payloads. The key is a media type or media type range and the value describes it. For responses that match multiple keys, only the most specific key is applicable. e.g. text/plain overrides text */
  content?: {
    [contentType: string]: MediaTypeObject;
  };
  /** A map of operations links that can be followed from the response. The key of the map is a short name for the link, following the naming constraints of the names for Component Objects. */
  links?: {
    [name: string]: LinkObject | ReferenceObject;
  };
}
/**
 * [4.8.18] Callback Object
 * A map of possible out-of band callbacks related to the parent operation. Each value in the map is a Path Item Object that describes a set of requests that may be initiated by the API provider and the expected responses. The key value used to identify the path item object is an expression, evaluated at runtime, that identifies a URL to use for the callback operation.
 */
type CallbackObject = Record<string, PathItemObject>;
/**
 * [4.8.19[ Example Object
 */
interface ExampleObject extends Extensable {
  /** Short description for the example. */
  summary?: string;
  /** Long description for the example. CommonMark syntax MAY be used for rich text representation. */
  description?: string;
  /** Embedded literal example. The value field and externalValue field are mutually exclusive. To represent examples of media types that cannot naturally represented in JSON or YAML, use a string value to contain the example, escaping where necessary. */
  value?: any;
  /** A URI that points to the literal example. This provides the capability to reference examples that cannot easily be included in JSON or YAML documents. The value field and externalValue field are mutually exclusive. See the rules for resolving Relative References. */
  externalValue?: string;
}
/**
 * [4.8.20] Link Object
 * The Link object represents a possible design-time link for a response. The presence of a link does not guarantee the caller’s ability to successfully invoke it, rather it provides a known relationship and traversal mechanism between responses and other operations.
 */
interface LinkObject extends Extensable {
  /** A relative or absolute URI reference to an OAS operation. This field is mutually exclusive of the operationId field, and MUST point to an Operation Object. Relative operationRef values MAY be used to locate an existing Operation Object in the OpenAPI definition. See the rules for resolving Relative References. */
  operationRef?: string;
  /** The name of an existing, resolvable OAS operation, as defined with a unique operationId. This field is mutually exclusive of the operationRef field. */
  operationId?: string;
  /** A map representing parameters to pass to an operation as specified with operationId or identified via operationRef. The key is the parameter name to be used, whereas the value can be a constant or an expression to be evaluated and passed to the linked operation. The parameter name can be qualified using the parameter location [{in}.]{name} for operations that use the same parameter name in different locations (e.g. path.id). */
  parameters?: {
    [name: string]: `$${string}`;
  };
  /** A literal value or {expression} to use as a request body when calling the target operation. */
  requestBody?: `$${string}`;
  /** A description of the link. CommonMark syntax MAY be used for rich text representation. */
  description?: string;
  /** A server object to be used by the target operation. */
  server?: ServerObject;
}
/**
 * [4.8.21] Header Object
 * The Header Object follows the structure of the Parameter Object with the following changes:
 *
 * 1. `name` MUST NOT be specified, it is given in the corresponding `headers` map.
 * 2. `in` MUST NOT be specified, it is implicitly in `header`.
 * 3. All traits that are affected by the location MUST be applicable to a location of `heade`r (for example, `style`).
 */
type HeaderObject = Omit<ParameterObject, "name" | "in">;
/**
 * [4.8.22] Tag Object
 * Adds metadata to a single tag that is used by the Operation Object. It is not mandatory to have a Tag Object per tag defined in the Operation Object instances.
 */
interface TagObject extends Extensable {
  /** REQUIRED. The name of the tag. */
  name: string;
  /** A description for the tag. CommonMark syntax MAY be used for rich text representation. */
  description?: string;
  /** Additional external documentation for this tag. */
  externalDocs?: ExternalDocumentationObject;
}
/**
 * [4.8.23] Reference Object
 * A simple object to allow referencing other components in the OpenAPI document, internally and externally. The $ref string value contains a URI [RFC3986], which identifies the location of the value being referenced. See the rules for resolving Relative References.
 */
interface ReferenceObject extends Extensable {
  /** REQUIRED. The reference identifier. This MUST be in the form of a URI. */
  $ref: string;
  /** A short summary which by default SHOULD override that of the referenced component. If the referenced object-type does not allow a summary field, then this field has no effect. */
  summary?: string;
  /** A description which by default SHOULD override that of the referenced component. CommonMark syntax MAY be used for rich text representation. If the referenced object-type does not allow a description field, then this field has no effect. */
  description?: string;
}
/**
 * [4.8.24] Schema Object
 * The Schema Object allows the definition of input and output data types. These types can be objects, but also primitives and arrays. This object is a superset of the JSON Schema Specification Draft 2020-12.
 */
type SchemaObject = {
  /** The Schema Object allows the definition of input and output data types. These types can be objects, but also primitives and arrays. This object is a superset of the JSON Schema Specification Draft 2020-12. */discriminator?: DiscriminatorObject; /** MAY be used only on properties schemas. It has no effect on root schemas. Adds additional metadata to describe the XML representation of this property. */
  xml?: XMLObject; /** Additional external documentation for this schema. */
  externalDocs?: ExternalDocumentationObject; /** @deprecated */
  example?: any;
  title?: string;
  description?: string;
  $comment?: string;
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  enum?: unknown[]; /** Use of this keyword is functionally equivalent to an "enum" (Section 6.1.2) with a single value. */
  const?: unknown;
  default?: unknown;
  format?: string; /** @deprecated in 3.1 (still valid for 3.0) */
  nullable?: boolean;
  oneOf?: (SchemaObject | ReferenceObject)[];
  allOf?: (SchemaObject | ReferenceObject)[];
  anyOf?: (SchemaObject | ReferenceObject)[];
  required?: string[];
  [key: `x-${string}`]: any;
} & (StringSubtype | NumberSubtype | IntegerSubtype | ArraySubtype | BooleanSubtype | NullSubtype | ObjectSubtype | {
  type: ("string" | "number" | "integer" | "array" | "boolean" | "null" | "object")[];
});
interface StringSubtype {
  type: "string" | ["string", "null"];
  enum?: (string | ReferenceObject)[];
}
interface NumberSubtype {
  type: "number" | ["number", "null"];
  minimum?: number;
  maximum?: number;
  enum?: (number | ReferenceObject)[];
}
interface IntegerSubtype {
  type: "integer" | ["integer", "null"];
  minimum?: number;
  maximum?: number;
  enum?: (number | ReferenceObject)[];
}
interface ArraySubtype {
  type: "array" | ["array", "null"];
  prefixItems?: (SchemaObject | ReferenceObject)[];
  items?: SchemaObject | ReferenceObject | (SchemaObject | ReferenceObject)[];
  minItems?: number;
  maxItems?: number;
  enum?: (SchemaObject | ReferenceObject)[];
}
interface BooleanSubtype {
  type: "boolean" | ["boolean", "null"];
  enum?: (boolean | ReferenceObject)[];
}
interface NullSubtype {
  type: "null";
}
interface ObjectSubtype {
  type: "object" | ["object", "null"];
  properties?: {
    [name: string]: SchemaObject | ReferenceObject;
  };
  additionalProperties?: boolean | Record<string, never> | SchemaObject | ReferenceObject;
  required?: string[];
  allOf?: (SchemaObject | ReferenceObject)[];
  anyOf?: (SchemaObject | ReferenceObject)[];
  enum?: (SchemaObject | ReferenceObject)[];
  $defs?: $defs;
}
/**
 * [4.8.25] Discriminator Object
 * When request bodies or response payloads may be one of a number of different schemas, a discriminator object can be used to aid in serialization, deserialization, and validation. The discriminator is a specific object in a schema which is used to inform the consumer of the document of an alternative schema based on the value associated with it.
 */
interface DiscriminatorObject {
  /** REQUIRED. The name of the property in the payload that will hold the discriminator value. */
  propertyName: string;
  /** An object to hold mappings between payload values and schema names or references. */
  mapping?: Record<string, string>;
  /** If this exists, then a discriminator type should be added to objects matching this path */
  oneOf?: string[];
}
/**
 * [4.8.26] XML Object
 * A metadata object that allows for more fine-tuned XML model definitions. When using arrays, XML element names are not inferred (for singular/plural forms) and the `name` property SHOULD be used to add that information. See examples for expected behavior.
 */
interface XMLObject extends Extensable {
  /** Replaces the name of the element/attribute used for the described schema property. When defined within `items`, it will affect the name of the individual XML elements within the list. When defined alongside `type` being `array` (outside the `items`), it will affect the wrapping element and only if `wrapped` is `true`. If `wrapped` is `false`, it will be ignored. */
  name?: string;
  /** The URI of the namespace definition. This MUST be in the form of an absolute URI. */
  namespace?: string;
  /** The prefix to be used for the name. */
  prefix?: string;
  /** Declares whether the property definition translates to an attribute instead of an element. Default value is `false`. */
  attribute?: boolean;
  /** MAY be used only for an array definition. Signifies whether the array is wrapped (for example, `<books><book/><book/></books>`) or unwrapped (`<book/><book/>`). Default value is `false`. The definition takes effect only when defined alongside `type` being `array` (outside the `items`). */
  wrapped?: boolean;
}
/**
 * [4.8.27] Security Scheme Object
 * Defines a security scheme that can be used by the operations.
 */
type SecuritySchemeObject = {
  /** A description for security scheme. CommonMark syntax MAY be used for rich text representation. */description?: string;
  [key: `x-${string}`]: any;
} & ({
  /** REQUIRED. The type of the security scheme. */type: "apiKey"; /** REQUIRED. The name of the header, query or cookie parameter to be used. */
  name: string; /** REQUIRED. The location of the API key. */
  in: "query" | "header" | "cookie";
} | {
  /** REQUIRED. The type of the security scheme. */type: "http"; /** REQUIRED. The name of the HTTP Authorization scheme to be used in the Authorization header as defined in [RFC7235]. The values used SHOULD be registered in the IANA Authentication Scheme registry. */
  scheme: string; /** A hint to the client to identify how the bearer token is formatted. Bearer tokens are usually generated by an authorization server, so this information is primarily for documentation purposes. */
  bearer?: string;
} | {
  /** REQUIRED. The type of the security scheme. */type: "mutualTLS";
} | {
  /** REQUIRED. Tye type of the security scheme. */type: "oauth2"; /** REQUIRED. An object containing configuration information for the flow types supported. */
  flows: OAuthFlowsObject;
} | {
  /** REQUIRED. Tye type of the security scheme. */type: "openIdConnect"; /** REQUIRED. OpenId Connect URL to discover OAuth2 configuration values. This MUST be in the form of a URL. The OpenID Connect standard requires the use of TLS. */
  openIdConnectUrl: string;
});
/**
 * [4.8.26] OAuth Flows Object
 * Allows configuration of the supported OAuth Flows.
 */
interface OAuthFlowsObject extends Extensable {
  /** Configuration for the OAuth Implicit flow */
  implicit?: OAuthFlowObject;
  /** Configuration for the OAuth Resource Owner Password flow */
  password?: OAuthFlowObject;
  /** Configuration for the OAuth Client Credentials flow. Previously called `application` in OpenAPI 2.0. */
  clientCredentials?: OAuthFlowObject;
  /** Configuration for the OAuth Authorization Code flow. Previously called `accessCode` in OpenAPI 2.0. */
  authorizationCode?: OAuthFlowObject;
}
/**
 * [4.8.29] OAuth Flow Object
 * Configuration details for a supported OAuth Flow
 */
interface OAuthFlowObject extends Extensable {
  /** REQUIRED. The authorization URL to be used for this flow. This MUST be in the form of a URL. The OAuth2 standard requires the use of TLS. */
  authorizationUrl: string;
  /** REQUIRED. The token URL to be used for this flow. This MUST be in the form of a URL. The OAuth2 standard requires the use of TLS. */
  tokenUrl: string;
  /** The URL to be used for obtaining refresh tokens. This MUST be in the form of a URL. The OAuth2 standard requires the use of TLS. */
  refreshUrl: string;
  /** REQUIRED. The available scopes for the OAuth2 security scheme. A map between the scope name and a short description for it. The map MAY be empty. */
  scopes: {
    [name: string]: string;
  };
}
/**
 * [4.8.30] Security Requirements Object
 * Lists the required security schemes to execute this operation. The name used for each property MUST correspond to a security scheme declared in the Security Schemes under the Components Object.
 */
type SecurityRequirementObject = { [P in keyof ComponentsObject["securitySchemes"]]?: string[] };
type $defs = Record<string, SchemaObject>; //#endregion
//#region src/types/handler.d.ts
type MaybeArray$1<T> = T | T[];
/** @experimental */
interface NitroRouteMeta {
  openAPI?: OperationObject & {
    $global?: Pick<OpenAPI3, "components"> & Extensable;
  };
}
interface NitroHandlerCommon {
  /**
   * HTTP pathname pattern to match
   *
   * Examples: `/test`, `/api/:id`, `/blog/**`
   */
  route: string;
  /**
   * HTTP method to match
   */
  method?: HTTPMethod;
  /**
   * Run handler as a middleware before other route handlings
   */
  middleware?: boolean;
  /**
   * Extra Meta
   */
  meta?: NitroRouteMeta;
}
type EventHandlerFormat = "web" | "node";
interface NitroEventHandler extends NitroHandlerCommon {
  /**
   * Use lazy loading to import handler
   */
  lazy?: boolean;
  /**
   * Path to event handler
   */
  handler: string;
  /**
   * Event handler type.
   *
   * Default is `"web"`. If set to `"node"`, the handler will be converted into a web compatible handler.
   */
  format?: EventHandlerFormat;
  env?: MaybeArray$1<"dev" | "prod" | "prerender" | PresetName | (string & {})>;
}
interface NitroDevEventHandler extends NitroHandlerCommon {
  /**
   * Event handler function
   */
  handler: HTTPHandler;
}
type MaybePromise<T> = T | Promise<T>;
type NitroErrorHandler = (error: HTTPError, event: HTTPEvent, _: {
  defaultHandler: (error: HTTPError, event: HTTPEvent, opts?: {
    silent?: boolean;
    json?: boolean;
  }) => MaybePromise<{
    status: number;
    statusText: string | undefined;
    headers: Record<string, string>;
    body: string | Record<string, any>;
  }>;
}) => MaybePromise<Response | void>; //#endregion
//#region src/runner/node.d.ts
interface EnvRunnerData {
  name?: string;
  [key: string]: unknown;
} //#endregion
//#region src/types/prerender.d.ts
interface PrerenderRoute {
  route: string;
  contents?: string;
  data?: ArrayBuffer;
  fileName?: string;
  error?: Error & {
    status: number;
    statusText: string;
  };
  generateTimeMS?: number;
  skip?: boolean;
  contentType?: string;
}
/** @deprecated Internal type will be removed in future versions */
//#endregion
//#region src/routing.d.ts
interface Route<T = unknown> {
  route: string;
  method: string;
  data: T;
}
declare class Router<T> {
  _routes?: Route<T>[];
  _router?: RouterContext<T>;
  _compiled?: Record<string, string>;
  _baseURL: string;
  constructor(baseURL?: string);
  get routes(): Route<T>[];
  _update(routes: Route<T>[], opts?: {
    merge?: boolean;
  }): void;
  hasRoutes(): boolean;
  compileToString(opts?: RouterCompilerOptions<T>): string;
  match(method: string, path: string): undefined | T;
  matchAll(method: string, path: string): T[];
} //#endregion
//#region src/types/_utils.d.ts
type Enumerate<N extends number, Acc extends number[] = []> = Acc["length"] extends N ? Acc[number] : Enumerate<N, [...Acc, Acc["length"]]>;
type IntRange<F extends number, T extends number> = Exclude<Enumerate<T>, Enumerate<F>>;
type ExcludeFunctions<G extends Record<string, any>> = Pick<G, { [P in keyof G]: NonNullable<G[P]> extends Function ? never : P }[keyof G]>; //#endregion
//#region src/types/route-rules.d.ts
type HTTPstatus = IntRange<100, 600>;
interface NitroRouteConfig {
  cache?: ExcludeFunctions<CachedEventHandlerOptions> | false;
  headers?: Record<string, string>;
  redirect?: string | {
    to: string;
    status?: HTTPstatus;
  };
  prerender?: boolean;
  proxy?: string | ({
    to: string;
  } & ProxyOptions);
  isr?: number | boolean | VercelISRConfig;
  cors?: boolean;
  swr?: boolean | number;
  static?: boolean | number;
}
interface NitroRouteRules extends Omit<NitroRouteConfig, "redirect" | "cors" | "swr" | "static"> {
  redirect?: {
    to: string;
    status: HTTPstatus;
  };
  proxy?: {
    to: string;
  } & ProxyOptions;
  [key: string]: any;
}
type MatchedRouteRule<K extends keyof NitroRouteRules = "custom"> = {
  name: K;
  options: Exclude<NitroRouteRules[K], false>;
  route: string;
  params?: Record<string, string>;
  handler?: (opts: unknown) => Middleware;
};
type MatchedRouteRules = { [K in keyof NitroRouteRules]: MatchedRouteRule<K> };
interface VercelISRConfig {
  /**
   * (vercel)
   * Expiration time (in seconds) before the cached asset will be re-generated by invoking the Serverless Function.
   * Setting the value to `false` (or `isr: true` route rule) means it will never expire.
   */
  expiration?: number | false;
  /**
   * (vercel)
   * Group number of the asset.
   * Prerender assets with the same group number will all be re-validated at the same time.
   */
  group?: number;
  /**
   * (vercel)
   * List of query string parameter names that will be cached independently.
   * - If an empty array, query values are not considered for caching.
   * - If undefined each unique query value is cached independently
   * - For wildcard `/**` route rules, `url` is always added.
   */
  allowQuery?: string[];
  /**
   * (vercel)
   * When `true`, the query string will be present on the `request` argument passed to the invoked function. The `allowQuery` filter still applies.
   */
  passQuery?: boolean;
} //#endregion
//#region src/types/nitro.d.ts
type MaybeArray<T> = T | T[];
interface Nitro {
  options: NitroOptions;
  scannedHandlers: NitroEventHandler[];
  vfs: Map<string, {
    render: () => string | Promise<string>;
  }>;
  hooks: Hookable<NitroHooks>;
  unimport?: Unimport;
  logger: ConsolaInstance;
  fetch: (input: Request) => Response | Promise<Response>;
  close: () => Promise<void>;
  updateConfig: (config: NitroDynamicConfig) => void | Promise<void>;
  routing: Readonly<{
    sync: () => void;
    routeRules: Router<NitroRouteRules & {
      _route: string;
    }>;
    routes: Router<MaybeArray<NitroEventHandler & {
      _importHash: string;
    }>>;
    globalMiddleware: (NitroEventHandler & {
      _importHash: string;
    })[];
    routedMiddleware: Router<NitroEventHandler & {
      _importHash: string;
    }>;
  }>;
  _prerenderedRoutes?: PrerenderRoute[];
  _prerenderMeta?: Record<string, {
    contentType?: string;
  }>;
}
type NitroDynamicConfig = Pick<NitroConfig, "runtimeConfig" | "routeRules">;
type NitroTypes = {
  routes: Record<string, Partial<Record<HTTPMethod | "default", string[]>>>;
  tsConfig?: TSConfig;
};
interface NitroFrameworkInfo {
  name?: "nitro" | (string & {});
  version?: string;
}
/** Build info written to `.output/nitro.json` or `.nitro/dev/nitro.json` */
//#endregion
//#region src/types/build.d.ts
type RollupConfig = InputOptions$1 & {
  output: OutputOptions$1;
};
type RolldownConfig = InputOptions & {
  output: OutputOptions;
};
interface OXCOptions {
  minify?: MinifyOptions;
  transform?: Omit<TransformOptions, "jsx"> & {
    jsx?: JsxOptions;
  };
} //#endregion
//#region src/types/hooks.d.ts
type HookResult = void | Promise<void>;
interface NitroHooks {
  "types:extend": (types: NitroTypes) => HookResult;
  "build:before": (nitro: Nitro) => HookResult;
  "rollup:before": (nitro: Nitro, config: RollupConfig) => HookResult;
  compiled: (nitro: Nitro) => HookResult;
  "dev:reload": (payload?: {
    entry?: string;
    workerData?: EnvRunnerData;
  }) => HookResult;
  "dev:start": () => HookResult;
  "dev:error": (cause?: unknown) => HookResult;
  "rollup:reload": () => HookResult;
  restart: () => HookResult;
  close: () => HookResult;
  "prerender:routes": (routes: Set<string>) => HookResult;
  "prerender:config": (config: NitroConfig) => HookResult;
  "prerender:init": (prerenderer: Nitro) => HookResult;
  "prerender:generate": (route: PrerenderRoute, nitro: Nitro) => HookResult;
  "prerender:route": (route: PrerenderRoute) => HookResult;
  "prerender:done": (result: {
    prerenderedRoutes: PrerenderRoute[];
    failedRoutes: PrerenderRoute[];
  }) => HookResult;
} //#endregion
//#region src/types/module.d.ts
type NitroModuleInput = string | NitroModule | NitroModule["setup"] | {
  nitro: NitroModule;
};
interface NitroModule {
  name?: string;
  setup: (this: void, nitro: Nitro) => void | Promise<void>;
} //#endregion
//#region src/types/openapi.d.ts
/**
 * Nitro OpenAPI configuration
 */
interface NitroOpenAPIConfig {
  /**
   * OpenAPI meta information
   */
  meta?: {
    title?: string;
    description?: string;
    version?: string;
  };
  /**
   * OpenAPI json route
   *
   * Default is `/_openapi.json`
   */
  route?: string;
  /**
   * Enable OpenAPI generation for production builds
   */
  production?: false | "runtime" | "prerender";
  /**
   * UI configurations
   */
  ui?: {
    /**
     * Scalar UI configuration
     */
    scalar?: false | (Partial<unknown> & {
      /**
       * Scalar UI route
       *
       * Default is `/_scalar`
       */
      route?: string;
    });
    /**
     * Swagger UI configuration
     */
    swagger?: false | {
      /**
       * Swagger UI route
       *
       * Default is `/_swagger`
       */
      route?: string;
    };
  };
} //#endregion
//#region src/types/preset.d.ts
type NitroPreset = NitroConfig | (() => NitroConfig);
//#endregion
//#region src/types/config.d.ts
type RollupCommonJSOptions = NonNullable<Parameters<typeof commonjs.default>[0]>;
/**
 * Nitro normalized options (nitro.options)
 */
interface NitroOptions extends PresetOptions {
  _config: NitroConfig;
  _c12: ResolvedConfig<NitroConfig> | ConfigWatcher<NitroConfig>;
  _cli?: {
    command?: string;
  };
  compatibilityDate: CompatibilityDates;
  debug: boolean;
  preset: PresetName;
  static: boolean;
  logLevel: LogLevel;
  runtimeConfig: NitroRuntimeConfig;
  workspaceDir: string;
  rootDir: string;
  serverDir: string | false;
  scanDirs: string[];
  apiDir: string;
  routesDir: string;
  buildDir: string;
  output: {
    dir: string;
    serverDir: string;
    publicDir: string;
  };
  /** @deprecated migrate to `serverDir` */
  srcDir: string;
  storage: StorageMounts;
  devStorage: StorageMounts;
  database: DatabaseConnectionConfigs;
  devDatabase: DatabaseConnectionConfigs;
  renderer?: {
    handler?: string;
    static?: boolean;
    template?: string;
  };
  ssrRoutes: string[];
  serveStatic: boolean | "node" | "deno" | "inline";
  noPublicDir: boolean;
  manifest?: {
    deploymentId?: string;
  };
  features: {
    /**
     * Enable runtime hooks for request and response.
     *
     * By default this feature will be enabled if there is at least one nitro plugin.
     */
    runtimeHooks?: boolean;
    /**
     * Enable WebSocket support
     */
    websocket?: boolean;
  };
  /**
   *
   * @see https://github.com/unjs/unwasm
   */
  wasm?: false | UnwasmPluginOptions;
  openAPI?: NitroOpenAPIConfig;
  experimental: {
    openAPI?: boolean;
    /**
     * See https://github.com/microsoft/TypeScript/pull/51669
     */
    typescriptBundlerResolution?: boolean;
    /**
     * Enable native async context support for useRequest()
     */
    asyncContext?: boolean;
    /**
     * Disable Experimental Sourcemap Minification
     */
    sourcemapMinify?: false;
    /**
     * Allow env expansion in runtime config
     *
     * @see https://github.com/nitrojs/nitro/pull/2043
     */
    envExpansion?: boolean;
    /**
     * Enable WebSocket support
     *
     * @see https://nitro.build/guide/websocket
     *
     * @deprecated use `features.websocket` instead.
     */
    websocket?: boolean;
    /**
     * Enable experimental Database support
     *
     * @see https://nitro.build/guide/database
     */
    database?: boolean;
    /**
     * Enable experimental Tasks support
     *
     * @see https://nitro.build/guide/tasks
     */
    tasks?: boolean;
    /**
     * Infer path aliases from tsconfig.json
     *
     * @default true
     */
    tsconfigPaths?: boolean;
  };
  future: {
    nativeSWR?: boolean;
  };
  serverAssets: ServerAssetDir[];
  publicAssets: PublicAssetDir[];
  imports: Partial<UnimportPluginOptions> | false;
  modules?: NitroModuleInput[];
  plugins: string[];
  tasks: {
    [name: string]: {
      handler?: string;
      description?: string;
    };
  };
  scheduledTasks: {
    [cron: string]: string | string[];
  };
  virtual: Record<string, string | (() => string | Promise<string>)>;
  compressPublicAssets: boolean | CompressOptions;
  ignore: string[];
  dev: boolean;
  devServer: {
    port?: number;
    hostname?: string;
    watch?: string[];
  };
  watchOptions: ChokidarOptions;
  devProxy: Record<string, string | ProxyServerOptions>;
  logging: {
    compressedSizes?: boolean;
    buildSuccess?: boolean;
  };
  baseURL: string;
  apiBaseURL: string;
  serverEntry: false | {
    handler: string;
    format?: EventHandlerFormat;
  };
  handlers: NitroEventHandler[];
  devHandlers: NitroDevEventHandler[];
  routeRules: {
    [path: string]: NitroRouteRules;
  };
  routes: Record<string, string | Omit<NitroEventHandler, "route" | "middleware">>;
  errorHandler: string | string[];
  devErrorHandler: NitroErrorHandler;
  prerender: {
    /**
     * Prerender HTML routes within subfolders (`/test` would produce `/test/index.html`)
     */
    autoSubfolderIndex?: boolean;
    concurrency?: number;
    interval?: number;
    crawlLinks?: boolean;
    failOnError?: boolean;
    ignore?: Array<string | RegExp | ((path: string) => undefined | null | boolean)>;
    ignoreUnprefixedPublicAssets?: boolean;
    routes?: string[];
    /**
     * Amount of retries. Pass Infinity to retry indefinitely.
     * @default 3
     */
    retry?: number;
    /**
     * Delay between each retry in ms.
     * @default 500
     */
    retryDelay?: number;
  };
  builder?: "rollup" | "rolldown" | "vite";
  rollupConfig?: RollupConfig;
  rolldownConfig?: RolldownConfig;
  entry: string;
  unenv: Preset$1[];
  alias: Record<string, string>;
  minify: boolean;
  inlineDynamicImports: boolean;
  sourcemap: boolean;
  node: boolean;
  moduleSideEffects: string[];
  oxc?: OXCOptions;
  replace: Record<string, string | ((id: string) => string)>;
  commonJS?: RollupCommonJSOptions;
  exportConditions?: string[];
  noExternals?: boolean | (string | RegExp)[];
  traceDeps?: (string | RegExp)[];
  typescript: {
    strict?: boolean;
    generateRuntimeConfigTypes?: boolean;
    generateTsConfig?: boolean;
    tsConfig?: Partial<TSConfig>;
    /**
     * Path of the generated types directory.
     *
     * Default is `node_modules/.nitro/types`
     */
    generatedTypesDir?: string;
    /**
     * Path of the generated `tsconfig.json` relative to `typescript.generatedTypesDir`
     *
     * Default is `tsconfig.json` (`node_modules/.nitro/types/tsconfig.json`)
     */
    tsconfigPath?: string;
  };
  hooks: NestedHooks<NitroHooks>;
  commands: {
    preview?: string;
    deploy?: string;
  };
  framework: NitroFrameworkInfo;
  iis?: {
    mergeConfig?: boolean;
    overrideConfig?: boolean;
  };
}
/**
 * Nitro input config (nitro.config)
 */
interface NitroConfig extends Partial<Omit<NitroOptions, "routeRules" | "rollupConfig" | "preset" | "compatibilityDate" | "unenv" | "serverDir" | "_config" | "_c12" | "serverEntry" | "renderer" | "output">>, C12InputConfig<NitroConfig> {
  preset?: PresetNameInput;
  extends?: string | string[] | NitroPreset;
  routeRules?: {
    [path: string]: NitroRouteConfig;
  };
  rollupConfig?: Partial<RollupConfig>;
  compatibilityDate?: CompatibilityDateSpec;
  unenv?: Preset$1 | Preset$1[];
  serverDir?: boolean | "./" | "./server" | (string & {});
  serverEntry?: string | NitroOptions["serverEntry"];
  renderer?: false | NitroOptions["renderer"];
  output?: Partial<NitroOptions["output"]>;
}
interface PublicAssetDir {
  baseURL?: string;
  fallthrough?: boolean;
  maxAge: number;
  dir: string;
  /**
   * Pass false to disable ignore patterns when scanning the directory, or
   * pass an array of glob patterns to ignore (which will override global
   * nitro.ignore patterns).
   */
  ignore?: false | string[];
}
interface CompressOptions {
  gzip?: boolean;
  brotli?: boolean;
}
interface ServerAssetDir {
  baseName: string;
  pattern?: string;
  dir: string;
  ignore?: string[];
}
type CustomDriverName = string & {
  _custom?: any;
};
interface StorageMounts {
  [path: string]: {
    driver: BuiltinDriverName | CustomDriverName;
    [option: string]: any;
  };
}
type DatabaseConnectionName = "default" | (string & {});
type DatabaseConnectionConfig = {
  connector: ConnectorName;
  options?: {
    [key: string]: any;
  };
};
type DatabaseConnectionConfigs = Record<DatabaseConnectionName, DatabaseConnectionConfig>;
interface NitroRuntimeConfig {
  nitro?: {
    envPrefix?: string;
    envExpansion?: boolean;
    routeRules?: {
      [path: string]: NitroRouteConfig;
    };
    openAPI?: NitroOpenAPIConfig;
  };
  [key: string]: any;
} //#endregion
//#region src/types/runner.d.ts
//#endregion
//#region src/types/global.d.ts
interface NitroImportMeta {
  dev?: boolean;
  preset?: NitroOptions["preset"];
  prerender?: boolean;
  nitro?: boolean;
  server?: boolean;
  client?: boolean;
  baseURL?: string;
  runtimeConfig?: Record<string, any>;
  _asyncContext?: boolean;
  _tasks?: boolean;
  _websocket?: boolean;
}
declare global {
  interface ImportMeta extends NitroImportMeta {}
} //#endregion
//#region src/types/h3.d.ts
declare module "srvx" {
  interface ServerRequestContext {
    routeRules?: MatchedRouteRules;
    nitro?: {
      runtimeConfig?: NitroRuntimeConfig;
      errors?: {
        error?: Error;
        context: CapturedErrorContext;
      }[];
    };
    cache?: {
      options?: CacheOptions$1;
    };
  }
} //#endregion
//#endregion
export { type Preset$1 as a, type Dispatcher as c, NitroRouteConfig as i, type NitroDevEventHandler as n, BuiltinDriverName as o, NitroEventHandler as r, Storage$1 as s, type Nitro as t };