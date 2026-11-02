/// <reference types="vite/client" />

interface Window {
  readonly orqstAnalytics?: import('@orqst/protocol').DesktopAnalytics;
  readonly orqstArtifacts?: import('@orqst/protocol').DesktopArtifacts;
}
