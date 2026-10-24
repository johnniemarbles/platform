#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRegistry } from './registry.ts';
import { loadManifest } from './manifest.ts';
import { validateManifest } from './validate.ts';

function parseArgs(args: string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(arg);
    }
  }

  return { command: positional[0] ?? 'validate', flags };
}

function resolvePlatformDir(flagVal?: string): string {
  if (flagVal && existsSync(flagVal)) return resolve(flagVal);
  if (process.env['PLATFORM_DIR'] && existsSync(process.env['PLATFORM_DIR'])) return resolve(process.env['PLATFORM_DIR']);
  const defaultSibling = resolve(process.cwd(), '../platform');
  if (existsSync(defaultSibling)) return defaultSibling;
  // Fallback to internal relative path from app-sync root:
  const internalPlatform = resolve(import.meta.dirname, '../../../..');
  if (existsSync(resolve(internalPlatform, 'core/registry/modules.json'))) return internalPlatform;
  return resolve(flagVal ?? '../platform');
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  const manifestPath = flags['manifest'] ?? resolve(process.cwd(), 'platform.app.json');
  const platformDir = resolvePlatformDir(flags['platform']);

  if (command === 'validate') {
    const registry = loadRegistry(platformDir);
    const manifest = loadManifest(manifestPath, platformDir);
    const problems = validateManifest(manifest, registry);

    const errors = problems.filter(p => p.level === 'error');
    const warnings = problems.filter(p => p.level === 'warning');

    for (const w of warnings) {
      console.warn(`[WARNING] ${w.path}: ${w.message}`);
    }

    if (errors.length > 0) {
      for (const e of errors) {
        console.error(`[ERROR] ${e.path}: ${e.message}`);
      }
      process.exit(1);
    }

    console.log(`✓ Manifest ${manifest.appId} (${manifest.displayName}) is valid.`);
    process.exit(0);
  }

  if (command === 'plan' || command === 'sync' || command === 'seed-dev') {
    console.log(`[app-sync] ${command} will be implemented in Phase B.`);
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
