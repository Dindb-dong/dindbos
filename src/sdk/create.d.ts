export interface CreateDindbOSProjectOptions {
  name?: string;
  force?: boolean;
}

export interface CreateDindbOSProjectResult {
  root: string;
  name: string;
}

export function createDindbOSProject(targetDir: string, options?: CreateDindbOSProjectOptions): Promise<CreateDindbOSProjectResult>;
export function normalizeProjectName(value: string): string;
