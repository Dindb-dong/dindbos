export interface DindbOSSessionOptions {
  user?: string;
  product?: string;
  groups?: string[];
  home?: string;
}

export interface DindbOSFileSeed {
  [path: string]: string | Uint8Array | ArrayBuffer | DindbOSFileSeed;
}

export interface DindbOSFileNode {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  mime?: string;
  content?: string | Uint8Array;
  children?: DindbOSFileNode[];
  [key: string]: unknown;
}

export interface DindbOSFileSystem {
  exists(path: string, cwd?: string): boolean;
  list(path?: string, cwd?: string): DindbOSFileNode[];
  resolve(path: string, cwd?: string): DindbOSFileNode;
  readFile(path: string, cwd?: string): string;
  readFileBytes(path: string, cwd?: string): Uint8Array;
  writeFile(path: string, content: string, cwd?: string): unknown;
  writeOrCreateFile(path: string, content: string, cwd?: string, options?: Record<string, unknown>): unknown;
  createDirectory(path: string, cwd?: string, options?: Record<string, unknown>): unknown;
  remove(path: string, cwd?: string, options?: Record<string, unknown>): unknown;
  stat(path: string, cwd?: string): Record<string, unknown>;
  normalize(path: string, cwd?: string): string;
  join(base: string, name: string): string;
  dirname(path: string): string;
  basename(path: string): string;
}

export interface DindbOSWindowAPI {
  id: string;
  close(): void;
  focus(): void;
  minimize(): void;
  maximize(): void;
  restore(): void;
  getState<T = unknown>(key?: string): T;
  setState<T>(key: string, value: T): T;
  setTitle(title: string): void;
  /** Set host-relative bounds, constrained to this desktop's usable workspace. */
  setBounds(rect: Partial<{ left: number; top: number; width: number; height: number }>): { left: number; top: number; width: number; height: number } | null;
  setBeforeClose(handler: () => boolean | Promise<boolean>): () => void;
  setAccessibilityTree(tree: unknown): unknown;
  getAccessibilityTree(): unknown;
  captureSurface(options?: Record<string, unknown>): unknown;
  captureDesktop(options?: Record<string, unknown>): unknown;
}

export interface DindbOSAppManifest {
  capabilities?: string[];
  fileSystem?: { read?: string[]; write?: string[] };
  shortcuts?: Array<string | { key: string; command?: string; scope?: string }>;
  [key: string]: unknown;
}

/** The existing permission-checked app facade, never the host's runtime. */
export interface DindbOSAppSandbox {
  session: Readonly<DindbOSSessionOptions>;
  fs: DindbOSFileSystem;
  launch(appId: string, context?: Record<string, unknown>): DindbOSWindowAPI;
  openPath(path: string, context?: Record<string, unknown>): unknown;
  apps: { list(): DindbOSAppSummary[]; getManifest(id: string): DindbOSAppManifest | null };
  state: { get<T = unknown>(key: string, fallback?: T): T; set<T>(key: string, value: T): T };
  syscall<T = unknown>(name: string, args?: Record<string, unknown>): T;
  syscallAsync<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}

export interface DindbOSAppContext<Context = Record<string, unknown>> {
  os: DindbOSAppSandbox;
  content: HTMLElement;
  window: DindbOSWindowAPI;
  context: Context;
}

export interface DindbOSAppSummary {
  id: string;
  name: string;
  icon?: unknown;
  pinned?: boolean;
  category?: string;
  singleton?: boolean;
  accepts?: string[];
  associationPriority?: number;
}

export interface DindbOSAppMenuItem<Context = Record<string, unknown>> {
  label: string;
  /** Optional display label; accelerator supplies keyboard handling. */
  shortcut?: string;
  /** Root-scoped chord such as Mod+Shift+K; Mod accepts Command or Control. */
  accelerator?: string;
  checked?: boolean;
  enabled?: boolean | ((context: DindbOSAppContext<Context>) => boolean);
  run(context: DindbOSAppContext<Context>): void | Promise<void>;
}
export type DindbOSAppMenus<Context = Record<string, unknown>> = Partial<Record<"file" | "edit" | "view" | "help", Array<DindbOSAppMenuItem<Context> | null>>>;

export interface DindbOSHostApp<Context = Record<string, unknown>> {
  id: string;
  name?: string;
  title?: string | ((context: Context) => string);
  icon?: unknown;
  pinned?: boolean;
  category?: string;
  desktop?: boolean;
  singleton?: boolean;
  width?: number;
  height?: number;
  chrome?: "standard" | "integrated" | "document";
  sidebarWidth?: number;
  minWidth?: number;
  minHeight?: number;
  accepts?: string[];
  associationPriority?: number;
  manifest?: DindbOSAppManifest;
  menus?: DindbOSAppMenus<Context> | ((context: DindbOSAppContext<Context>) => DindbOSAppMenus<Context>);
  render(context: DindbOSAppContext<Context>): void | (() => void);
  dispose?(context: DindbOSAppContext<Context>): void;
}

export type AppDefinition<Context = Record<string, unknown>> = DindbOSHostApp<Context>;
export function defineApp<Context = Record<string, unknown>>(definition: DindbOSHostApp<Context>): DindbOSHostApp<Context>;
export function defineApp<Context = Record<string, unknown>>(definition: Omit<DindbOSHostApp<Context>, "render">, render: DindbOSHostApp<Context>["render"]): DindbOSHostApp<Context>;

export interface DindbOSSlotContext {
  element: HTMLElement;
  state: Record<string, unknown>;
  actions: Record<string, (...args: any[]) => unknown>;
  defaultRender(): void;
}
export type DindbOSSlotRenderer = (context: DindbOSSlotContext) => void | (() => void);
export interface DindbOSUIOptions {
  slots?: Partial<Record<"desktop" | "menubar" | "dock" | "windowChrome", DindbOSSlotRenderer>>;
  liquidGlass?: boolean | { strength?: number; blur?: number; maxSurfaces?: number };
}

export interface DindbOSStorageAdapter {
  loadFileSystem(): unknown | Promise<unknown>;
  saveFileSystem(root: unknown): unknown;
  status?(): Record<string, unknown>;
}

export interface DindbOSStorageConfig {
  backend?: "browser" | "indexeddb" | "opfs" | "memory" | string;
  name?: string;
  key?: string;
  cacheName?: string;
}

export interface DindbOSPackageConfig {
  registries?: Array<{ name: string; url: string }>;
  trustedPublishers?: Array<{ id: string; name?: string; publicKey: string }>;
  manifests?: Array<Record<string, unknown>>;
}

export interface DindbOSServiceWorkerConfig {
  enabled?: boolean;
  scriptUrl?: string;
  scope?: string;
}

export interface DindbOSBrokerConfig {
  browserProviderUrl?: string;
  browserProviderLabel?: string;
  url?: string;
  label?: string;
  companions?: Array<Record<string, unknown>>;
}

export interface DindbOSIsolationConfig {
  preferOriginIsolated?: boolean;
  allowDegraded?: boolean;
  requiredHeaders?: Record<string, string>;
}

export interface DindbOSDiagnosticsEvidence {
  id?: string;
  profile: string;
  status: "pass" | "fail" | "degraded" | "blocked";
  runner?: string;
  recordedAt?: string;
  categories?: string[];
  artifacts?: string[];
  notes?: string;
}

export interface DindbOSDiagnosticsConfig {
  evidence?: DindbOSDiagnosticsEvidence[];
  onConformanceEvidence?: (record: DindbOSDiagnosticsEvidence, os: DindbOS) => unknown;
}

export interface DindbOSThemeConfig {
  mode?: "light" | "dark" | "system";
  accent?: string;
  wallpaper?: "meadow" | "coast" | "dusk" | string;
  dockSize?: number;
  className?: string;
  variables?: Record<string, string | number>;
}

export interface CreateDindbOSOptions {
  root?: string | HTMLElement | null;
  signal?: AbortSignal;
  ui?: DindbOSUIOptions;
  fileSystem?: DindbOSFileSeed;
  files?: DindbOSFileSeed;
  session?: DindbOSSessionOptions;
  storage?: DindbOSStorageAdapter | DindbOSStorageConfig;
  cache?: unknown;
  persistDelayMs?: number;
  safeBootProfile?: string;
  bootProfile?: string;
  builtins?: false | Record<string, unknown>;
  bootstrapPackages?: boolean;
  launch?: Array<string | { id: string; context?: Record<string, unknown> }>;
  apps?: DindbOSHostApp[];
  packages?: DindbOSPackageConfig;
  serviceWorker?: false | true | DindbOSServiceWorkerConfig;
  brokers?: DindbOSBrokerConfig;
  browserProvider?: DindbOSBrokerConfig;
  isolation?: DindbOSIsolationConfig;
  diagnostics?: DindbOSDiagnosticsConfig;
  theme?: DindbOSThemeConfig;
  configure?: (os: DindbOS, config: DindbOSHostConfig) => unknown | Promise<unknown>;
  installApps?: (os: DindbOS) => unknown | Promise<unknown>;
}

export interface DindbOSHostConfig extends Omit<CreateDindbOSOptions, "storage" | "serviceWorker" | "configure" | "installApps"> {
  storage: { adapter: DindbOSStorageAdapter | null; runtimeOptions: Record<string, unknown>; public: Record<string, unknown> };
  serviceWorker: { enabled: boolean; scriptUrl: string; scope: string; mode: string };
  configure: ((os: DindbOS, config: DindbOSHostConfig) => unknown | Promise<unknown>) | null;
  installApps: ((os: DindbOS) => unknown | Promise<unknown>) | null;
}

export class DindbOS {
  constructor(options?: Record<string, unknown>);
  sdkHostConfig?: Record<string, unknown>;
  session: DindbOSSessionOptions & { user: string; home: string; groups: string[]; product: string };
  destroyed: boolean;
  root: HTMLElement | null;
  fs: DindbOSFileSystem;
  apps: {
    has(id: string): boolean;
    list(): DindbOSHostApp[];
    getManifest(id: string): DindbOSAppManifest | null;
    register(app: DindbOSHostApp): DindbOSAppManifest;
    unregister(id: string): boolean;
  };
  packages: { list(): Array<Record<string, unknown>>; info(id: string): Record<string, unknown> };
  windows: { has(id: string): boolean; close(id: string): void; focus(id: string): void; minimize(id: string): void; maximize(id: string): void; restore(id: string): void };
  destroy(): Promise<void>;
  registerApp(app: DindbOSHostApp): void;
  unregisterApp(id: string): boolean;
  setAppearance(theme: DindbOSThemeConfig): unknown;
  appearance: DindbOSThemeConfig;
  boot(): void;
  loadPersistentFileSystem(options?: Record<string, unknown>): Promise<void>;
  runBootPhase<T>(id: string, action: () => T | Promise<T>): Promise<T>;
  registerServiceWorkerBoot(scriptUrl?: string, options?: { scope?: string }): Promise<unknown>;
  launch(appId: string, context?: Record<string, unknown>): DindbOSWindowAPI;
  addConformanceEvidence(record: DindbOSDiagnosticsEvidence): DindbOSDiagnosticsEvidence;
  conformanceEvidenceRecords(): DindbOSDiagnosticsEvidence[];
}

export const BOOT_PHASES: Array<{ id: string; label: string }>;

export function createDindbOS(options?: CreateDindbOSOptions): Promise<DindbOS>;
export function bootDindbOS(os: DindbOS, options?: CreateDindbOSOptions): Promise<DindbOS>;
export function createAndBootDindbOS(options?: CreateDindbOSOptions): Promise<DindbOS>;
export function prepareDindbOSHost(os: DindbOS, options?: CreateDindbOSOptions | DindbOSHostConfig): Promise<DindbOS>;
export function normalizeDindbOSHostConfig(options?: CreateDindbOSOptions): DindbOSHostConfig;
export function publicHostConfig(config?: DindbOSHostConfig): Record<string, unknown>;
export function applyDindbOSHostConfig(os: DindbOS, config?: DindbOSHostConfig): Promise<DindbOS>;
export function installDindbOSBuiltins(os: DindbOS, options?: Record<string, unknown>): unknown;
export function installBuiltinApps(os: DindbOS, options?: Record<string, unknown>): unknown;
export function compatibilitySnapshot(runtime?: Record<string, unknown>): Record<string, unknown>;
export function conformanceReport(runtime?: Record<string, unknown>): Record<string, unknown>;
export function isolationSnapshot(browser?: Record<string, unknown>): Record<string, unknown>;

export function applyDindbOSTheme(os: DindbOS, theme?: DindbOSThemeConfig): void;
