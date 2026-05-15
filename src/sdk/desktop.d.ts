import type { CreateDindbOSOptions, DindbOS } from "./index.js";

export interface MountDindbOSDesktopOptions extends CreateDindbOSOptions {
  bootScreen?: boolean;
  bootTarget?: HTMLElement;
}

export function mountBootScreen(options?: Record<string, unknown>): Record<string, unknown>;
export function mountDindbOSDesktop(options?: MountDindbOSDesktopOptions): Promise<DindbOS>;
export function createDindbOS(options?: CreateDindbOSOptions): Promise<DindbOS>;
export function bootDindbOS(os: DindbOS, options?: CreateDindbOSOptions): Promise<DindbOS>;
export function createAndBootDindbOS(options?: CreateDindbOSOptions): Promise<DindbOS>;
