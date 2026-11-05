import { terminalDigest } from '../terminal/authority.js';
import {
  parseManagedCodexConfigBytes,
  terminalFile,
  validateManagedCodexConfig,
} from '../terminal/codex-profile.js';
import { armLifecycleReceipt, assertLifecycleConfig } from './lifecycle-receipt.js';

/** Authenticate one private snapshot before its paths can cause any validation effects. */
export function prepareNativeHost(file: string, receiptFd: number) {
  const bytes = terminalFile(file, true);
  const digest = terminalDigest(bytes);
  assertLifecycleConfig(receiptFd, digest);
  const config = parseManagedCodexConfigBytes(bytes);
  validateManagedCodexConfig(config);
  const receipt = armLifecycleReceipt(receiptFd, digest);
  return { config, receipt };
}
