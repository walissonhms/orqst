import { createRoot } from 'react-dom/client';
import { FeatureWorkspace } from './FeatureWorkspace.js';
import './i18n.js';
import './feature-shell.css';

/** Mounts only chrome; native terminal children retain their own documents and xterm. */
export function mountFeatureWorkspace() {
  createRoot(document.getElementById('root')!).render(<FeatureWorkspace nativeWorkspace />);
}
