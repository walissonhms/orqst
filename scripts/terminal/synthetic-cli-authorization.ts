// Explicit synthetic acceptance bundles only; never included in production builds.
import type { Plugin } from 'esbuild';

export function syntheticCliAuthorization(): Plugin {
  return {
    name: 'synthetic-cli-authorization',
    setup(build) {
      build.onResolve({ filter: /cli-system-signature\.js$/ }, () => ({
        path: 'synthetic-signature',
        namespace: 'synthetic-cli-authorization',
      }));
      build.onResolve({ filter: /cli-version-probe\.js$/ }, () => ({
        path: 'synthetic-probe',
        namespace: 'synthetic-cli-authorization',
      }));
      build.onLoad(
        { filter: /synthetic-signature/, namespace: 'synthetic-cli-authorization' },
        () => ({
          contents: `const identities = { codex: {teamId:'2DC432GLL2', identifier:'codex'}, claude:{teamId:'Q6L2SF6YDW',identifier:'com.anthropic.claude-code'}, opencode:{teamId:'5NZ4Q7NXJ4',identifier:'opencode'} }; export const systemCliSignatureVerifier = { async verify(provider) { return { valid:true, ...identities[provider] }; } };`,
          loader: 'js',
        }),
      );
      build.onLoad({ filter: /synthetic-probe/, namespace: 'synthetic-cli-authorization' }, () => ({
        contents: `import { createHash } from 'node:crypto'; import { readFileSync } from 'node:fs'; const identities = { codex: {teamId:'2DC432GLL2', identifier:'codex'}, claude:{teamId:'Q6L2SF6YDW',identifier:'com.anthropic.claude-code'}, opencode:{teamId:'5NZ4Q7NXJ4',identifier:'opencode'} }; export async function probeSignedCliVersion(_verifier, provider, mode, executable) { const version = provider === 'codex' ? '0.162.1' : provider === 'claude' ? '2.1.318' : '2.2.5'; return { version, sha256:createHash('sha256').update(readFileSync(executable)).digest('hex'), signature:{valid:true,...identities[provider]}, contract:{provider,mode,minimum:version,maximum:version,revision:provider+'-'+mode+'-'+version} }; }`,
        loader: 'js',
      }));
    },
  };
}
