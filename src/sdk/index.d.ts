export interface DindbOSSessionOptions {
  user?: string;
  product?: string;
  groups?: string[];
  home?: string;
}

export interface DindbOSFileSeed {
  [path: string]: string | Uint8Array | ArrayBuffer | DindbOSFileSeed;
}

export interface DindbOSHostApp {
  id: string;
  name?: string;
  title?: string | ((context: Record<string, unknown>) => string);
  icon?: string;
  pinned?: boolean;
  singleton?: boolean;
  width?: number;
  height?: number;
  manifest?: Record<string, unknown>;
  render: (context: Record<string, unknown>) => unknown;
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
  className?: string;
  variables?: Record<string, string | number>;
}

export interface CreateDindbOSOptions {
  root?: string | HTMLElement | null;
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
  session: Record<string, unknown>;
  fs: unknown;
  apps: unknown;
  packages: unknown;
  boot(): void;
  loadPersistentFileSystem(options?: Record<string, unknown>): Promise<void>;
  runBootPhase<T>(id: string, action: () => T | Promise<T>): Promise<T>;
  registerServiceWorkerBoot(scriptUrl?: string): Promise<unknown>;
  launch(appId: string, context?: Record<string, unknown>): unknown;
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
