export interface CreateDindbOSProjectOptions {
  name?: string;
  force?: boolean;
  template?: "react" | "vanilla";
  dryRun?: boolean;
  pages?: boolean;
}
export interface CreateDindbOSProjectResult {
  root: string;
  name: string;
  template: "react" | "vanilla";
  files: string[];
  dryRun: boolean;
}
export function createDindbOSProject(targetDir?: string, options?: CreateDindbOSProjectOptions): Promise<CreateDindbOSProjectResult>;
export function addDindbOSApp(name: string, options?: CreateDindbOSProjectOptions & {root?: string}): Promise<{root: string; id: string; template: string; files: string[]; dryRun: boolean}>;
export function doctorDindbOSProject(root?: string): Promise<{root: string; ok: boolean; checks: Array<{name: string; ok: boolean; detail: string}>}>;
export function normalizeProjectName(value: string): string;
export function runDindbOSCLI(args?: string[]): Promise<unknown>;
