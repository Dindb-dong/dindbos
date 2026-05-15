import type { DindbOS } from "./index.js";

export interface BuiltinAppOptions {
  includePortfolio?: boolean;
  portfolioData?: {
    name: string;
    summary: string;
    projects: Array<{ name: string; type: string; description: string }>;
  };
}

export const BROWSER_LOCAL_HTML_SANDBOX: string;
export function installBuiltinApps(os: DindbOS, options?: BuiltinAppOptions): unknown;
export function installDindbOSBuiltins(os: DindbOS, options?: BuiltinAppOptions): unknown;
