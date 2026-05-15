import type { CreateDindbOSOptions, DindbOS } from "./index.js";

export interface CreateBootedTestDindbOSOptions extends CreateDindbOSOptions {
  root: string | HTMLElement;
}

export function createHeadlessDindbOS(options?: CreateDindbOSOptions): Promise<DindbOS>;
export function createBootedTestDindbOS(options: CreateBootedTestDindbOSOptions): Promise<DindbOS>;
