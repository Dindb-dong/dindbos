import type { ReactNode, CSSProperties } from "react";
import type { CreateDindbOSOptions, DindbOS, DindbOSHostApp, DindbOSAppContext } from "./index.js";

export { defineApp } from "./index.js";

export interface DindbOSReactContext {
  os: DindbOS | null;
  ready: boolean;
  booting: boolean;
  error: unknown;
}

export interface DindbOSProviderProps {
  os?: DindbOS | null;
  error?: unknown;
  booting?: boolean;
  children?: ReactNode;
}

export interface DindbOSDesktopProps extends CreateDindbOSOptions {
  options?: CreateDindbOSOptions;
  bootScreen?: boolean;
  bootTarget?: HTMLElement;
  className?: string;
  style?: CSSProperties;
  onReady?: (os: DindbOS) => void;
  onError?: (error: unknown) => void;
  children?: ReactNode;
}

export interface DindbOSAppProps<Context = Record<string, unknown>> extends Omit<DindbOSHostApp<Context>, "render" | "dispose" | "icon"> {
  icon?: ReactNode;
  children?: ReactNode | ((app: DindbOSAppContext<Context>) => ReactNode);
  onError?: (error: Error) => void;
}

export function DindbOSProvider(props: DindbOSProviderProps): ReactNode;
export function useDindbOS(): DindbOSReactContext;
export function useDindbOSApp<Context = Record<string, unknown>>(): DindbOSAppContext<Context>;
export function DindbOSDesktop(props: DindbOSDesktopProps): ReactNode;
export function DindbOSApp<Context = Record<string, unknown>>(props: DindbOSAppProps<Context>): ReactNode;
