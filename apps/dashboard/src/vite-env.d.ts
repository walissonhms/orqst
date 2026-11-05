/// <reference types="vite/client" />

interface Window {
  readonly orqstTauriStudio?: import('@orqst/protocol').TauriStudio;
  readonly orqstFeatures?: import('@orqst/protocol').DesktopFeatures;
  readonly orqstFeaturePermissions?: {
    read(featureId: string): Promise<{
      status: string;
      permissions?: { revision: number; configuration: unknown };
    }>;
    propose(request: {
      featureId: string;
      expectedRevision: number;
      configuration: unknown;
    }): Promise<{ status: string; permissions?: { revision: number; configuration: unknown } }>;
  };
  readonly orqstTerminalDock?: {
    restore(slot: number, generation: number): Promise<boolean>;
  };
  readonly orqstStudio?: import('@orqst/protocol').DesktopStudio;
  readonly orqstManagedAgents?: import('@orqst/protocol').DesktopManagedAgents;
  readonly orqstAnalytics?: import('@orqst/protocol').DesktopAnalytics;
  readonly orqstArtifacts?: import('@orqst/protocol').DesktopArtifacts;
}
