import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

export interface ModuleBundleKey {
  key: string;
  since: string;
  autoGrant?: boolean;
}

export interface ModuleBundle {
  description: string;
  permissions: ModuleBundleKey[];
}

export interface ModuleVersionEntry {
  major: number;
  status: 'current' | 'deprecated';
  sunset?: string | null;
}

export interface ModuleDefinition {
  status: string;
  package: string;
  contractVersion: string;
  summary: string;
  permissions: string[];
  routes: string[];
  migrations: string[];
  uiKit: string | null;
  bundles?: Record<string, ModuleBundle>;
  sdkPackage?: string | null;
  versions?: ModuleVersionEntry[];
}

export interface ModuleRegistry {
  registryVersion: number;
  modules: Record<string, ModuleDefinition>;
}

export interface CheckModuleChangeInput {
  baseRegistry: ModuleRegistry;
  headRegistry: ModuleRegistry;
  changedFiles: string[];
  changelogs: Record<string, string>;
  sdkPackages?: Record<string, { version: string }>;
  commitMessages?: string[];
  currentDate?: string;
}

export interface CheckModuleChangeResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  refactorSummary?: string | undefined;
}

const SENSITIVE_SEGMENTS = new Set([
  'export',
  'delete',
  'purge',
  'admin',
  'manage',
  'impersonate',
  'billing',
  'refund',
  'merge_all',
]);

function parseSemver(v: string): [number, number, number] {
  const parts = v.split('.').map((p) => parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function checkModuleChanges(input: CheckModuleChangeInput): CheckModuleChangeResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let refactorSummary: string | undefined;

  const commits = input.commitMessages ?? [];
  const allCommitText = commits.join('\n');

  // Check escape hatch: Module-Change: none (<reason>)
  const refactorMatch = allCommitText.match(/Module-Change:\s*none\s*(?:\(([^)]+)\))?/i);
  const isRefactorExemption = Boolean(refactorMatch);
  if (isRefactorExemption) {
    refactorSummary = `Refactor exemption applied: ${refactorMatch![1] ?? 'no reason specified'}`;
  }

  const currentDate = input.currentDate ?? new Date().toISOString().slice(0, 10);

  for (const [modId, headMod] of Object.entries(input.headRegistry.modules)) {
    const baseMod = input.baseRegistry.modules[modId];
    if (!baseMod) {
      // New module, no diff against past
      continue;
    }

    // Determine if any files belonging to this module changed
    const modPkgSubpath = headMod.package.replace('@platform-core/', 'core/packages/').replace('@platform-hub/', 'hub/packages/');
    const modRouteSubpath = `core/apps/platform-api/src/modules/${modId}`;
    const modSdkSubpath = headMod.sdkPackage ? `core/sdk/${modId}` : null;
    const migrations = headMod.migrations ?? [];

    const moduleFilesChanged = input.changedFiles.some((f) => {
      if (f.startsWith(modPkgSubpath)) return true;
      if (f.startsWith(modRouteSubpath)) return true;
      if (modSdkSubpath && f.startsWith(modSdkSubpath)) return true;
      if (migrations.some((m) => f.includes(m))) return true;
      return false;
    });

    const [baseMajor, baseMinor, basePatch] = parseSemver(baseMod.contractVersion);
    const [headMajor, headMinor, headPatch] = parseSemver(headMod.contractVersion);

    // Rule 1: If files changed, contractVersion must bump AND changelog must have a section
    if (moduleFilesChanged && !isRefactorExemption) {
      if (headMod.contractVersion === baseMod.contractVersion) {
        errors.push(
          `Module '${modId}' files modified but contractVersion was not bumped (currently ${headMod.contractVersion}).`
        );
      }

      const changelog = input.changelogs[modId] ?? '';
      const versionHeaderRegex = new RegExp(`^##\\s+${headMod.contractVersion.replace(/\./g, '\\.')}\\b`, 'm');
      if (!versionHeaderRegex.test(changelog)) {
        errors.push(
          `Module '${modId}' changelog missing section for version ${headMod.contractVersion} in changelog/${modId}.md.`
        );
      }
    }

    // Rule 2: Breaking changes require major bump
    const baseRoutes = new Set(baseMod.routes ?? []);
    const headRoutes = new Set(headMod.routes ?? []);
    const removedRoutes: string[] = [];
    for (const r of baseRoutes) {
      if (!headRoutes.has(r)) removedRoutes.push(r);
    }

    const basePerms = new Set(baseMod.permissions ?? []);
    const headPerms = new Set(headMod.permissions ?? []);
    const removedPerms: string[] = [];
    for (const p of basePerms) {
      if (!headPerms.has(p)) removedPerms.push(p);
    }

    const baseBundles = baseMod.bundles ?? {};
    const headBundles = headMod.bundles ?? {};
    const removedBundleKeys: string[] = [];
    for (const [bName, bDef] of Object.entries(baseBundles)) {
      const headB = headBundles[bName];
      if (!headB) {
        removedBundleKeys.push(`bundle:${bName}`);
      } else {
        const headKeys = new Set(headB.permissions.map((p) => p.key));
        for (const bp of bDef.permissions) {
          if (!headKeys.has(bp.key)) {
            removedBundleKeys.push(`${bName}.${bp.key}`);
          }
        }
      }
    }

    const hasRemovals = removedRoutes.length > 0 || removedPerms.length > 0 || removedBundleKeys.length > 0;
    if (hasRemovals) {
      if (headMajor <= baseMajor) {
        errors.push(
          `Module '${modId}' has breaking removals (routes: [${removedRoutes.join(', ')}], permissions: [${removedPerms.join(', ')}], bundles: [${removedBundleKeys.join(', ')}]) but major version was not bumped.`
        );
      }
    }

    // Rule 3: Existing bundle key's `since` or `autoGrant` cannot change; sensitive segment rule on new keys
    for (const [bName, bDef] of Object.entries(headBundles)) {
      const baseB = baseBundles[bName];
      for (const hp of bDef.permissions) {
        if (baseB) {
          const baseP = baseB.permissions.find((p) => p.key === hp.key);
          if (baseP) {
            if (baseP.since !== hp.since) {
              errors.push(
                `Module '${modId}' bundle '${bName}' key '${hp.key}' changed 'since' from ${baseP.since} to ${hp.since}.`
              );
            }
            const baseAuto = baseP.autoGrant ?? true;
            const headAuto = hp.autoGrant ?? true;
            if (baseAuto !== headAuto) {
              errors.push(
                `Module '${modId}' bundle '${bName}' key '${hp.key}' changed 'autoGrant' from ${baseAuto} to ${headAuto}.`
              );
            }
            continue; // Not a new key
          }
        }

        // New key in bundle
        const lastSegment = hp.key.split('.').pop() || '';
        const isSensitive = SENSITIVE_SEGMENTS.has(lastSegment);
        const autoGrant = hp.autoGrant ?? true;
        // Permitted with autoGrant=true only if since equals the bundle's first version
        const allSinces = bDef.permissions.map((p) => p.since).sort();
        const firstBundleVersion = allSinces[0];
        if (isSensitive && autoGrant && hp.since !== firstBundleVersion) {
          errors.push(
            `Module '${modId}' bundle '${bName}' new key '${hp.key}' has sensitive segment '${lastSegment}' and must have autoGrant: false.`
          );
        }
      }
    }

    // Rule 4: SDK package major.minor equals contractVersion major.minor
    if (headMod.sdkPackage && input.sdkPackages) {
      const sdkPkg = input.sdkPackages[modId];
      if (sdkPkg) {
        const [sdkMaj, sdkMin] = parseSemver(sdkPkg.version);
        if (sdkMaj !== headMajor || sdkMin !== headMinor) {
          errors.push(
            `Module '${modId}' SDK package version ${sdkPkg.version} does not match contractVersion ${headMod.contractVersion} major.minor.`
          );
        }
      }
    }

    // Rule 5: Deprecated version cannot be removed unless sunset has passed AND Sunset-Approved-By: Sanjeev
    const baseVersions = baseMod.versions ?? [];
    const headVersions = headMod.versions ?? [];
    for (const bv of baseVersions) {
      if (bv.status === 'deprecated') {
        const stillExists = headVersions.some((hv) => hv.major === bv.major);
        if (!stillExists) {
          const sunsetPassed = bv.sunset && bv.sunset <= currentDate;
          const hasApproval = /Sunset-Approved-By:\s*Sanjeev/i.test(allCommitText);
          if (!sunsetPassed || !hasApproval) {
            errors.push(
              `Module '${modId}' deprecated version ${bv.major} was removed without sunset date passed (${bv.sunset}) or missing trailer 'Sunset-Approved-By: Sanjeev'.`
            );
          }
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    refactorSummary,
  };
}

// CLI runner
async function runCli() {
  const platformRoot = resolve(import.meta.dirname, '../..');
  const modulesPath = resolve(platformRoot, 'core/registry/modules.json');
  if (!existsSync(modulesPath)) {
    console.error('core/registry/modules.json not found');
    process.exit(1);
  }

  const headRegistry: ModuleRegistry = JSON.parse(readFileSync(modulesPath, 'utf8'));

  let baseRegistry: ModuleRegistry = headRegistry;
  let changedFiles: string[] = [];
  let commitMessages: string[] = [];

  try {
    // Try git diff against origin/main or HEAD~1
    const baseRef = process.env['BASE_REF'] || 'origin/main';
    try {
      const baseJson = execSync(`git show ${baseRef}:core/registry/modules.json`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      baseRegistry = JSON.parse(baseJson);
    } catch {
      // If baseRef is not fetchable, fallback to HEAD~1
      try {
        const baseJson = execSync(`git show HEAD~1:core/registry/modules.json`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        baseRegistry = JSON.parse(baseJson);
      } catch {
        baseRegistry = headRegistry;
      }
    }

    const diffOutput = execSync(`git diff --name-only ${baseRef}...HEAD`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    changedFiles = diffOutput ? diffOutput.split('\n') : [];

    const logOutput = execSync(`git log ${baseRef}...HEAD --format=%B`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    commitMessages = logOutput ? [logOutput] : [];
  } catch {
    // Local / non-git diff context
    changedFiles = [];
  }

  const changelogs: Record<string, string> = {};
  const sdkPackages: Record<string, { version: string }> = {};

  for (const [modId, mod] of Object.entries(headRegistry.modules)) {
    const clPath = resolve(platformRoot, `core/registry/changelog/${modId}.md`);
    if (existsSync(clPath)) {
      changelogs[modId] = readFileSync(clPath, 'utf8');
    }
    if (mod.sdkPackage) {
      const pkgPath = resolve(platformRoot, `core/sdk/${modId}/package.json`);
      if (existsSync(pkgPath)) {
        sdkPackages[modId] = JSON.parse(readFileSync(pkgPath, 'utf8'));
      }
    }
  }

  const res = checkModuleChanges({
    baseRegistry,
    headRegistry,
    changedFiles,
    changelogs,
    sdkPackages,
    commitMessages,
  });

  if (res.refactorSummary) {
    console.log(`[check-module-change] ${res.refactorSummary}`);
  }

  if (!res.ok) {
    console.error('[check-module-change] Gate failed with errors:');
    for (const e of res.errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  console.log('✓ Module change CI gate: OK');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  runCli();
}
