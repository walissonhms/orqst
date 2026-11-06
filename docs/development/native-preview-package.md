# Native Preview package procedure

## Rules

- Run on macOS arm64 with the repository's pinned Node 24 / pnpm 10 and coordinated Rust toolchain.
- Freeze one clean source SHA from `origin/feat/frontend-768` after the intended fixes are integrated.
- Build in an isolated Git worktree. Never run root `pnpm build`; it cleans shared output.
- Preserve every existing `dist/native-preview-*` tree, executable and resource. An existing destination is an error, never permission to replace it.
- Never close, stop or launch the owner's application as part of packaging. Never change admission markers, lifecycle evidence, user profiles or credentials.
- Use one coordinated Cargo target and serialize heavy builds. Require at least 8 GiB free for this procedure; stop earlier if the actual build needs a larger margin. Check space before and after staging/build/package.
- Do not build or replace the shared Cargo bundle if an executable from that bundle is running. Do not terminate it to continue.
- Fail on every nonzero command, hash mismatch, dirty source, changed SHA or missing resource. Preserve partial output for inspection; do not silently retry uncertain operations.
- Keep logs, generated packages, manifests and local verification evidence outside Git. Do not commit `dist`, `node_modules`, captured sessions or agent instructions.
- Ad-hoc signing is a local development signature. Package verification is not notarization or native/provider acceptance.
- Do not edit the frozen worktree while checks or bundling run. Documentation-only follow-ups must retain the package's actual source SHA.

## Commands

```bash
set -euo pipefail

export PATH="$HOME/.local/share/orqst/toolchain/bin:/private/tmp/orqst-rust-693/rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
export ORQST_NODE_LICENSE=/private/tmp/orqst-676-node24-license
export CARGO_HOME=/private/tmp/orqst-rust-693/cargo
export RUSTUP_HOME=/private/tmp/orqst-rust-693/rustup
export RUSTUP_TOOLCHAIN=1.99.1-aarch64-apple-darwin
export CARGO_TARGET_DIR=/private/tmp/orqst-691-target
export CARGO_PROFILE_DEV_DEBUG=0
export CARGO_INCREMENTAL=0
export CARGO_BUILD_JOBS=1

package_checkout=/Users/walissonhmsouza/developer/AgentReport
git -C "$package_checkout" fetch origin feat/frontend-768
package_sha="$(git -C "$package_checkout" rev-parse origin/feat/frontend-768)"
package_source="/private/tmp/orqst-native-package-${package_sha:0:7}"
package_destination="$package_checkout/dist/native-preview-studio-${package_sha:0:7}"

test ! -e "$package_source"
test ! -e "$package_destination"
test -f "$ORQST_NODE_LICENSE"
node --version
pnpm --version
rustc --version
python3 - "$package_checkout" <<'SPACE'
import pathlib, shutil, sys
free = shutil.disk_usage(pathlib.Path(sys.argv[1])).free
print({'freeGiBBefore': round(free / 1024**3, 2)})
assert free >= 8 * 1024**3, 'Insufficient coordinated build margin'
SPACE

# Stop if this prints a running executable from the shared Cargo bundle.
ps -axo pid=,comm=
# Review before continuing; never kill a running owner Preview.
git -C "$package_checkout" worktree add --detach "$package_source" "$package_sha"

# Checks, staging, build, copy, signing and verification run in this order.
python3 - "$package_source" "$package_sha" <<'PACKAGE'
import pathlib, subprocess, os, sys, json, time, re, hashlib, shutil, stat
source=pathlib.Path(sys.argv[1]).resolve(); sha=sys.argv[2]
assert re.fullmatch('[0-9a-f]{40}',sha)
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()==sha
assert not subprocess.check_output(['git','status','--porcelain'],cwd=source,text=True).strip()
root=pathlib.Path('/Users/walissonhmsouza/developer/AgentReport')
destination=root/'dist'/('native-preview-studio-'+sha[:7])
if destination.exists():raise RuntimeError('Existing package is preserved: '+str(destination))
logs=pathlib.Path('/private/tmp')/('orqst-native-checks-'+sha[:7]); logs.mkdir(exist_ok=False)
env=os.environ.copy();env.update({'PATH':'/Users/walissonhmsouza/.local/share/orqst/toolchain/bin:/private/tmp/orqst-rust-693/rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:'+env['PATH'],'ORQST_NODE_LICENSE':'/private/tmp/orqst-676-node24-license','CARGO_HOME':'/private/tmp/orqst-rust-693/cargo','RUSTUP_HOME':'/private/tmp/orqst-rust-693/rustup','RUSTUP_TOOLCHAIN':'1.99.1-aarch64-apple-darwin','CARGO_TARGET_DIR':'/private/tmp/orqst-691-target','CARGO_PROFILE_DEV_DEBUG':'0','CARGO_INCREMENTAL':'0','CARGO_BUILD_JOBS':'1'})
free_before=shutil.disk_usage(root).free
if free_before<8*1024**3:raise RuntimeError('Insufficient coordinated build margin')
checks=[]
def run(name,cmd,cwd=source,timeout=900):
 start=time.time()
 with (logs/(name+'.log')).open('w') as output:r=subprocess.run(cmd,cwd=cwd,env=env,stdout=output,stderr=subprocess.STDOUT,timeout=timeout)
 item={'command':cmd,'exitCode':r.returncode,'seconds':round(time.time()-start,3)};checks.append(item)
 (logs/'checks.json').write_text(json.dumps(checks,indent=2)+'\n')
 print(json.dumps({'step':name,'exitCode':item['exitCode'],'seconds':item['seconds']}),flush=True)
 if r.returncode:raise RuntimeError('Failed '+name+'; log='+str(logs/(name+'.log')))
run('install',['pnpm','install','--offline','--frozen-lockfile'])
run('lint',['pnpm','lint'])
run('typecheck',['pnpm','typecheck'])
# Full unchanged suite, serial file scheduling bounded to 2. No skip or timeout changes.
run('full-test',['pnpm','exec','tsx','--test','--test-concurrency=2']+[str(p.relative_to(source)) for p in sorted((source/'tests').glob('*.test.ts'))])
run('dashboard',['pnpm','--filter','@orqst/dashboard','build'])
run('staging',['node','scripts/build-tauri-resources.mjs'])
manifest='apps/tauri/src-tauri/Cargo.toml'
run('cargo-test',['cargo','test','--locked','--manifest-path',manifest,'--features','custom-protocol'])
run('clippy',['cargo','clippy','--locked','--manifest-path',manifest,'--features','custom-protocol','--all-targets','--','-D','warnings'])
run('cargo-build',['cargo','build','--locked','--manifest-path',manifest,'--features','custom-protocol'])
processes=subprocess.check_output(['/bin/ps','-axo','pid=,comm='],text=True)
shared=pathlib.Path('/private/tmp/orqst-691-target/debug/bundle/macos/ORQST Preview.app')
if str(shared)+'/Contents/MacOS/' in processes:raise RuntimeError('Shared bundle is running: preserve it')
run('bundle',['pnpm','--dir','apps/tauri','exec','tauri','build','--debug','--bundles','app','--config',json.dumps({'build':{'beforeBuildCommand':None}})])
destination.mkdir(exist_ok=False)
app=destination/'ORQST Preview.app'
run('copy-bundle',['ditto',str(shared),str(app)])
run('codesign',['codesign','--force','--deep','--sign','-',str(app)])
run('verify-signature',['codesign','--verify','--deep','--strict','--verbose=2',str(app)])
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def mapping(p):return {str(f.relative_to(p)):digest(f) for f in sorted(p.rglob('*')) if f.is_file()}
resources={}
for name in ['core','dashboard','licenses','terminal','agents','files','features']:
 staged=mapping(source/'apps/tauri/dist'/name); packaged=mapping(app/'Contents/Resources'/name)
 if not staged or staged!=packaged:raise RuntimeError('Resource mismatch '+name)
 resources[name]={'files':len(staged),'identicalToStaging':True}
helper=list((app/'Contents/Resources/core').rglob('spawn-helper'))
assert len(helper)==1 and stat.S_IMODE(helper[0].stat().st_mode)==0o700
workspace=app/'Contents/Resources/features/workspace.js'
markers={m:m in workspace.read_text() for m in ['ts-modes','layoutVersion','accountLimits','communication']}
assert all(markers.values())
terminal_host=app/'Contents/Resources/core/tauri-terminal-host.cjs'
assert 'data-chrome' in terminal_host.read_text() and 'studioChrome' in terminal_host.read_text()
assert 'unmatched' in (app/'Contents/Resources/core/managed-terminal-core.cjs').read_text()
files=[p for p in sorted(app.rglob('*')) if p.is_file()]
sums=destination/'SHA256SUMS';sums.write_text(''.join(digest(p)+'  '+str(p.relative_to(app))+'\n' for p in files))
run('verify-hashes',['shasum','-a','256','-c',str(sums)],cwd=app)
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()==sha
assert not subprocess.check_output(['git','status','--porcelain'],cwd=source,text=True).strip()
def counts(log):
 text=re.sub(r'\x1b\[[0-9;]*m','',log.read_text());result={}
 for label in ['tests','pass','fail','cancelled','skipped']:
  matches=re.findall(r'ℹ '+label+r' (\d+)',text)
  if matches:result[label]=int(matches[-1])
 return result
node=counts(logs/'full-test.log');assert node.get('tests',0)>0 and node.get('pass')==node['tests'] and not node.get('fail') and not node.get('cancelled')
rust=re.search(r'test result: ok\. (\d+) passed; 0 failed; (\d+) ignored',(logs/'cargo-test.log').read_text());assert rust
shutil.copytree(logs,destination/'checks')
data={'schemaVersion':1,'source':{'branch':'origin/feat/frontend-768','sha':sha,'dirty':False},'createdAtEpochMs':int(time.time()*1000),'app':str(app),'build':{'target':'aarch64-apple-darwin','profile':'debug','customProtocol':True,'signature':'ad-hoc','notarized':False,'rootPnpmBuild':False},'checks':checks,'nodeTests':node,'rustTests':{'passed':int(rust[1]),'ignored':int(rust[2])},'resources':resources,'workspaceMarkers':markers,'nativeDocumentStudioMarker':True,'ownedHooksUnmatchedMarker':True,'spawnHelperMode':'0700','sha256':{'executable':digest(app/'Contents/MacOS/orqst-desktop'),'node':digest(app/'Contents/MacOS/orqst-node'),'workspaceJs':digest(workspace),'SHA256SUMS':digest(sums)},'regularAppFiles':len(files),'applicationLaunched':False,'nativeAcceptance':False,'providerAcceptance':False,'freeBytesBeforeBuild':free_before,'freeBytesAfterBuild':shutil.disk_usage(root).free,'warnings':['rust-objcopy debug stripping may warn about missing libLLVM.dylib; see exact Cargo logs and exit codes.','Vite may emit its existing chunk-size advisory; see build log.'],'limits':['Local development candidate with ad-hoc signing; actual macOS/provider acceptance pending.','App never opened; prior packages and user processes preserved.','Normal independent terminals do not acquire an MCP/composer delivery route.','Response completion is not delegated task or process completion.']}
(destination/'package-verification.json').write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({'package':str(app),'manifestSha256':digest(destination/'package-verification.json'),'sha256':data['sha256'],'nodeTests':node,'rustTests':data['rustTests'],'freeGiBAfter':round(data['freeBytesAfterBuild']/1024**3,2)}),flush=True)
PACKAGE
```

## Preservation checks

```bash
# Run against every already finalized package that must remain untouched.
# Set this to its exact existing package directory; do not use the new destination.
preserved_package=/Users/walissonhmsouza/developer/AgentReport/dist/native-preview-studio-d840e3c
(
  cd "$preserved_package/ORQST Preview.app"
  shasum -a 256 -c "$preserved_package/SHA256SUMS"
)

# The new package is verified after signing, never before the final modification.
shasum -a 256 "$package_destination/package-verification.json"
codesign --verify --deep --strict --verbose=2 "$package_destination/ORQST Preview.app"
(
  cd "$package_destination/ORQST Preview.app"
  shasum -a 256 -c "$package_destination/SHA256SUMS"
)
python3 - "$package_checkout" <<'SPACE'
import pathlib, shutil, sys
print({'freeGiBAfter': round(shutil.disk_usage(pathlib.Path(sys.argv[1])).free / 1024**3, 2)})
SPACE
```

## Cleanup rules

- Remove the disposable worktree only after the source is integrated/committed/pushed, its tree is clean, checks/logs are preserved and no executable, runtime or process cwd uses it.
- Use `git worktree remove`, without force. If it refuses, preserve the worktree and investigate.
- Keep the delivered package and its complete verification evidence. Preserve active packages, private runtimes, quarantines and uncertain lifecycle evidence.
- Do not remove the coordinated Cargo target while another task may use it.

```bash
cd "$package_checkout"
git fetch origin feat/frontend-768
git merge-base --is-ancestor "$package_sha" origin/feat/frontend-768
test -z "$(git -C "$package_source" status --porcelain)"
# Verify absence of source-tree executables and process cwd before removal.
ps -axo pid=,comm=
lsof -nP -d cwd -F n
git worktree remove "$package_source"
```
