/// <reference types="vite/client" />

interface Window {
  readonly orqstTauriStudio?: import('@orqst/protocol').TauriStudio;
  readonly orqstFeatures?: import('@orqst/protocol').DesktopFeatures;
  readonly orqstTerminalDock?: { restore(slot: number): Promise<boolean> };
  readonly orqstStudio?: import('@orqst/protocol').DesktopStudio;
  readonly orqstManagedAgents?: import('@orqst/protocol').DesktopManagedAgents;
  readonly orqstAnalytics?: import('@orqst/protocol').DesktopAnalytics;
  readonly orqstArtifacts?: import('@orqst/protocol').DesktopArtifacts;
}
