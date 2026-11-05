import { dashboardPathSchema, featureNativeSnapshotSchema } from '@orqst/protocol';
import { invoke } from '@tauri-apps/api/core';
import { createFeatureClient } from './features-bridge.js';

if (
  window.top === window.self &&
  (location.href === 'orqst-features://local/index.html' ||
    dashboardPathSchema.safeParse(location.pathname, { jitless: true }).success)
) {
  Object.defineProperty(window, 'orqstFeatures', {
    value: createFeatureClient(
      (request) => invoke('feature_request', { request }),
      () => navigator.userActivation.isActive,
      location.href === 'orqst-features://local/index.html'
        ? (request) => invoke('feature_prepare', { request })
        : undefined,
    ),
  });
  window.addEventListener('orqst-native-feature-state', (event) => {
    const parsed = featureNativeSnapshotSchema.safeParse((event as CustomEvent).detail, {
      jitless: true,
    });
    if (parsed.success)
      window.dispatchEvent(new CustomEvent('orqst-feature-state', { detail: parsed.data }));
  });
}
