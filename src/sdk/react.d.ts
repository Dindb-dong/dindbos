import type { ReactNode, CSSProperties } from "react";
import type { CreateDindbOSOptions, DindbOS } from "./index.js";

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
  className?: string;
  style?: CSSProperties;
  onReady?: (os: DindbOS) => void;
  onError?: (error: unknown) => void;
  children?: ReactNode;
}

export function DindbOSProvider(props: DindbOSProviderProps): ReactNode;
export function useDindbOS(): DindbOSReactContext;
export function DindbOSDesktop(props: DindbOSDesktopProps): ReactNode;
