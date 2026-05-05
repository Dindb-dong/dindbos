export type DindbOSSDKResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; syscall: string } };

export class DindbOSSDKError extends Error {
  code: string;
  syscall: string;
  result: DindbOSSDKResult | null;
  constructor(result: DindbOSSDKResult | null, syscall: string);
}

export interface DindbOSSDK {
  syscall: {
    raw<T = unknown>(name: string, args?: Record<string, unknown>): DindbOSSDKResult<T>;
    call<T = unknown>(name: string, args?: Record<string, unknown>): T;
  };
  clock: {
    now(): { iso: string; ms: number };
  };
  entropy: {
    randomBytes(length: number): Uint8Array;
  };
  fs: {
    exists(path: string, args?: Record<string, unknown>): boolean;
    stat<T = unknown>(path: string, args?: Record<string, unknown>): T;
    readText(path: string, args?: Record<string, unknown>): string;
    writeText(path: string, content: string, args?: Record<string, unknown>): { path: string; bytes: number };
  };
  fd: {
    list<T = unknown>(): T[];
    open<T = unknown>(path: string, args?: Record<string, unknown>): T;
    read(fd: number, args?: Record<string, unknown>): { fd: number; data: string; bytes: number; offset: number; eof: boolean };
    write(fd: number, data: string, args?: Record<string, unknown>): { fd: number; bytes: number; offset: number };
    seek(fd: number, offset: number, args?: Record<string, unknown>): { fd: number; offset: number };
    stat<T = unknown>(fd: number): T;
    ioctl<T = unknown>(fd: number, request: string, args?: Record<string, unknown>): T;
    close(fd: number): { fd: number; closed: true };
  };
  env: {
    get(key: string): string;
    list(): Record<string, string>;
  };
  apps: {
    list<T = unknown>(): T[];
    manifest<T = unknown>(appId: string): T;
    launch(appId: string, context?: Record<string, unknown>): { appId: string; pid: number; windowId: string };
  };
  packages: {
    list<T = unknown>(): T[];
    info<T = unknown>(packageId: string): T;
  };
  storage: {
    status<T = unknown>(): T;
  };
  localMounts: {
    status<T = unknown>(): T;
  };
  processes: {
    current<T = unknown>(): T;
    list<T = unknown>(): T[];
    get<T = unknown>(pid: number): T;
    log(message: string, args?: Record<string, unknown>): { pid: number; logged: true };
  };
}

export function createDindbOSSDK(
  target: ((name: string, args?: Record<string, unknown>) => DindbOSSDKResult) | { syscall(name: string, args?: Record<string, unknown>): DindbOSSDKResult; process?: { pid?: number } },
  options?: { currentPid?: number },
): DindbOSSDK;
