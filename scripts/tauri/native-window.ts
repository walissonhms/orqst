// Read-only WindowServer evidence for an explicitly owned native process.
// Developer-only acceptance support: no production module imports this file.
import { execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const CAPTURABLE_MIN_WIDTH = 200;
export const CAPTURABLE_MIN_HEIGHT = 150;
export const PROBE_OUTPUT_LIMIT = 64 * 1024;
export const PROBE_TIMEOUT_MS = 5_000;

/** Subscribe immediately after spawn, before asynchronous window inspection. */
export function observeNativeFixtureExit(child: ChildProcess): Promise<boolean> {
  return once(child, 'exit').then(
    () => false,
    () => true,
  );
}

const integer = z.number().int().safe();
const windowSchema = z
  .strictObject({
    number: integer.nonnegative(),
    layer: integer,
    alpha: z.number().min(0).max(1),
    onscreen: z.boolean(),
    bounds: z
      .strictObject({
        x: integer,
        y: integer,
        width: integer.nonnegative(),
        height: integer.nonnegative(),
      })
      .strict(),
    // Owner names are bounded metadata; window titles are deliberately not captured.
    owner: z.string().max(64),
  })
  .strict();
const sampleSchema = z
  .strictObject({
    tool: z.literal('orqst-native-window-probe'),
    pid: integer.min(2),
    windows: z.array(windowSchema).max(32),
  })
  .strict();
export type NativeWindow = z.infer<typeof windowSchema>;
export type NativeWindowSample = z.infer<typeof sampleSchema>;

export type NativeWindowStatus =
  | 'window-observed'
  | 'window-exists-offscreen'
  | 'no-window'
  | 'process-exited'
  | 'probe-unavailable'
  | 'probe-invalid';

export interface NativeWindowEvidence {
  status: NativeWindowStatus;
  waitedMs: number;
  samples: number;
  lastError?: string;
  windows: NativeWindow[];
}

export function parseNativeWindowSample(text: string): NativeWindowSample {
  return sampleSchema.parse(JSON.parse(text));
}

function isCapturable(window: NativeWindow): boolean {
  return (
    window.layer === 0 &&
    window.alpha > 0 &&
    window.onscreen &&
    window.bounds.width >= CAPTURABLE_MIN_WIDTH &&
    window.bounds.height >= CAPTURABLE_MIN_HEIGHT
  );
}

function isVisibleWindow(window: NativeWindow): boolean {
  return (
    window.layer === 0 &&
    window.alpha > 0 &&
    window.bounds.width >= CAPTURABLE_MIN_WIDTH &&
    window.bounds.height >= CAPTURABLE_MIN_HEIGHT
  );
}

/** Compiles the checked-in probe inside a private directory, or returns undefined when absent. */
export function compileNativeWindowProbe(
  directory: string,
  compiler = '/usr/bin/swiftc',
): string | undefined {
  const source = fileURLToPath(new URL('./native-window-probe.swift', import.meta.url));
  const cache = `${directory}/module-cache`;
  const target = `${directory}/native-window-probe`;
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  try {
    execFileSync(compiler, ['-O', '-module-cache-path', cache, '-o', target, source], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 120_000,
      env: { PATH: '/usr/bin:/bin', TMPDIR: directory },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Native window probe did not compile', { cause: error });
  }
  return target;
}

export function runNativeWindowProbe(probe: string, pid: number): NativeWindowSample {
  const stdout = execFileSync(probe, ['--pid', String(pid)], {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: PROBE_OUTPUT_LIMIT,
    env: { PATH: '/usr/bin:/bin' },
  });
  const sample = parseNativeWindowSample(stdout);
  if (sample.pid !== pid) throw new Error('Native window probe returned another process');
  return sample;
}

export interface CaptureOptions {
  timeoutMs?: number;
  intervalMs?: number;
  run?: (probe: string, pid: number) => NativeWindowSample;
  alive?: (pid: number) => boolean;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Waits for a bounded, owned-process window. A single sample never proves rendering,
 * focus, consent or acceptance; it only reports WindowServer metadata for this PID.
 */
export async function captureNativeWindow(
  probe: string,
  pid: number,
  options: CaptureOptions = {},
): Promise<NativeWindowEvidence> {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('Invalid native window probe pid');
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 500;
  if (timeoutMs < 0 || intervalMs < 0) throw new Error('Invalid native window probe timing');
  const run = options.run ?? runNativeWindowProbe;
  const alive = options.alive ?? processAlive;
  const now = options.now ?? Date.now;
  const delay = options.delay ?? sleep;
  const started = now();
  let samples = 0;
  let lastError: string | undefined;
  let offscreen: NativeWindow[] | undefined;
  for (;;) {
    if (!alive(pid)) {
      return {
        status: 'process-exited',
        waitedMs: now() - started,
        samples,
        windows: offscreen ?? [],
        ...(lastError === undefined ? {} : { lastError }),
      };
    }
    try {
      const sample = run(probe, pid);
      samples++;
      lastError = undefined;
      if (sample.windows.some(isCapturable)) {
        return {
          status: 'window-observed',
          waitedMs: now() - started,
          samples,
          windows: sample.windows,
        };
      }
      if (sample.windows.some(isVisibleWindow)) offscreen = sample.windows;
    } catch (error) {
      // A transient probe failure is retried; the deadline still bounds the wait.
      lastError = (error as Error).message.slice(0, 200);
    }
    if (now() - started >= timeoutMs) {
      if (offscreen) {
        return {
          status: 'window-exists-offscreen',
          waitedMs: now() - started,
          samples,
          windows: offscreen,
        };
      }
      return {
        status: lastError === undefined ? 'no-window' : 'probe-invalid',
        waitedMs: now() - started,
        samples,
        windows: [],
        ...(lastError === undefined ? {} : { lastError }),
      };
    }
    await delay(intervalMs);
  }
}
