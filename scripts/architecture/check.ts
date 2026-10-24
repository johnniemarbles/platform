/**
 * Architecture check: enforces zone and layer rules from Platform Architecture Plan V3.1.
 * Run: node --experimental-strip-types scripts/architecture/check.ts
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export interface SdkGroup {
  name: string;
  packages: string[];
  allowedPaths?: string[];
}

export interface ZoneConfig {
  name: string;
  pathPrefix: string;
  packages?: string[];
  packagesNotIn?: string;
  mayDependOnZones?: string[];
  allowedCrossZonePackages?: string[];
  sdkGroupsAllowed?: string[];
  forbidDependingOnSameZone?: boolean;
  notes?: string;
}

export interface ArchitectureConfig {
  zones?: ZoneConfig[];
  sdkGroups: SdkGroup[];
  baseAllowedDeps?: Record<string, string[]>;
  moduleAllowedDeps?: string[];
  forbiddenPackages?: string[];
  allowedExternalLayerPackages?: string[];
  permissionChecks?: boolean;
  turboRequired?: boolean;
}

export interface Violation {
  rule: 'zone' | 'provider-sdk' | 'workspace-deps' | 'forbidden-package' | 'permission-check' | 'turbo' | 'ui-purity';
  file: string;
  line?: number;
  message: string;
}

export interface WorkspacePackage {
  name: string;
  dir: string; // relative, '/'-separated
  kind: 'library' | 'app';
  deps: string[];
}

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.turbo', 'dist', '.next', 'coverage', '.tmp-dist']);
const IMPORT_RE =
  /(?:^|[^\w.$])(?:import\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?|export\s+(?:type\s+)?[\w*{}\s,$]+\s+from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

const TYPE_ONLY_IMPORT_RE =
  /(?:^|[^\w.$])(?:import\s+type\s+|export\s+type\s+)/;

const PERMISSION_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\b(?:role|roleName|role_name|roleKey)\s*(?:===|!==|==|!=)\s*['"`]/, why: 'compares a role name' },
  { re: /['"`][\w-]+['"`]\s*(?:===|!==|==|!=)\s*\w*\.?(?:role|roleName|role_name)\b/, why: 'compares a role name' },
  { re: /\.hasRole\s*\(/, why: 'calls hasRole(); check a permission key instead' },
  { re: /\broles?\.includes\s*\(\s*['"`]/, why: 'checks membership of a named role' },
  { re: /\b(?:userId|user_id|personId|person_id)\s*(?:===|==)\s*['"`][\w-]{6,}['"`]/, why: 'special-cases a user ID' },
];

const toPosix = (p: string) => p.split(sep).join('/');

export function loadConfig(root: string): ArchitectureConfig {
  const file = join(root, 'architecture.config.json');
  if (!existsSync(file)) throw new Error(`architecture.config.json not found in ${root}`);
  return JSON.parse(readFileSync(file, 'utf8')) as ArchitectureConfig;
}

export function listWorkspaceDirs(root: string): string[] {
  const out: string[] = [];
  function scan(dir: string, depth: number) {
    if (depth > 3 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (existsSync(join(full, 'package.json'))) {
          out.push(full);
        } else {
          scan(full, depth + 1);
        }
      }
    }
  }
  scan(root, 1);
  return out;
}

export function readWorkspace(root: string): WorkspacePackage[] {
  return listWorkspaceDirs(root).map((dir) => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const rel = toPosix(relative(root, dir));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies });
    return { name: pkg.name as string, dir: rel, kind: rel.includes('/apps/') || rel.startsWith('apps/') ? 'app' : 'library', deps };
  });
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) yield* walk(full);
    else if (SOURCE_EXT.test(entry)) yield full;
  }
}

function matchSdk(spec: string, sdks: string[]): string | undefined {
  const parts = spec.split('/');
  const base = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  return sdks.find((s) => {
    if (s.endsWith('/')) return base.startsWith(s);
    if (s.endsWith('*')) return base.startsWith(s.slice(0, -1));
    return base === s;
  });
}

export function zoneOf(pkg: { name: string; dir: string }, zones: ZoneConfig[]): ZoneConfig | undefined {
  const matching = zones.filter((z) => pkg.dir === z.pathPrefix.replace(/\/$/, '') || pkg.dir.startsWith(z.pathPrefix));
  if (matching.length === 0) return undefined;

  const maxPrefixLen = Math.max(...matching.map((m) => m.pathPrefix.length));
  const candidates = matching.filter((m) => m.pathPrefix.length === maxPrefixLen);

  if (candidates.length === 1) return candidates[0];

  const explicit = candidates.find((c) => c.packages && c.packages.includes(pkg.name));
  if (explicit) return explicit;

  const notIn = candidates.find((c) => c.packagesNotIn);
  if (notIn) return notIn;

  return candidates[0];
}

const isAllowedPath = (rel: string, allowed: string[] = []) =>
  allowed.some((p) => rel === p || rel.startsWith(p.endsWith('/') ? p : `${p}/`));

const isTestFile = (rel: string) => /(^|\/)(test|tests|__tests__)\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);

export function check(root: string, config: ArchitectureConfig = loadConfig(root)): Violation[] {
  const violations: Violation[] = [];
  const workspace = readWorkspace(root);
  const workspaceNames = new Set(workspace.map((p) => p.name));
  const byName = new Map(workspace.map((p) => [p.name, p]));
  const zones = config.zones ?? [];

  // Turbo wiring
  if (config.turboRequired) {
    if (!existsSync(join(root, 'turbo.json'))) {
      violations.push({ rule: 'turbo', file: 'turbo.json', message: 'turbo.json is missing' });
    }
    for (const p of workspace) {
      const pkg = JSON.parse(readFileSync(join(root, p.dir, 'package.json'), 'utf8'));
      for (const script of ['typecheck', 'test']) {
        if (!pkg.scripts?.[script]) {
          violations.push({ rule: 'turbo', file: `${p.dir}/package.json`, message: `missing "${script}" script, so turbo cannot run it` });
        }
      }
    }
  }

  // Zone assignment and dependency rules
  for (const p of workspace) {
    const pkgFile = `${p.dir}/package.json`;
    let pZone: ZoneConfig | undefined;

    if (zones.length > 0) {
      pZone = zoneOf(p, zones);
      if (!pZone) {
        violations.push({ rule: 'zone', file: pkgFile, message: `package "${p.name}" at "${p.dir}" does not match any architectural zone` });
      }
    }

    for (const dep of p.deps) {
      const forbidden = (config.forbiddenPackages ?? []).find((f) => dep === f || dep.startsWith(f));
      if (forbidden && !(config.allowedExternalLayerPackages ?? []).includes(dep)) {
        violations.push({ rule: 'forbidden-package', file: pkgFile, message: `depends on "${dep}", which this layer must not use` });
      }

      for (const group of config.sdkGroups) {
        if (matchSdk(dep, group.packages)) {
          const isAllowedInZone = pZone && pZone.sdkGroupsAllowed?.includes(group.name);
          const isAllowedPathMatch = group.allowedPaths && group.allowedPaths.some((a) => isAllowedPath(p.dir, [a]) || a.startsWith(`${p.dir}/`));
          if (!isAllowedInZone && !isAllowedPathMatch) {
            violations.push({ rule: 'provider-sdk', file: pkgFile, message: `depends on ${group.name} SDK "${dep}"; not allowed in ${pZone?.name ?? p.dir}` });
          }
        }
      }

      if (workspaceNames.has(dep)) {
        const target = byName.get(dep)!;
        const targetZone = zones.length > 0 ? zoneOf(target, zones) : undefined;

        if (pZone && targetZone) {
          const allowedCross = pZone.allowedCrossZonePackages?.includes(dep);
          const mayDependOnZone = pZone.mayDependOnZones?.includes(targetZone.name);

          if (pZone.forbidDependingOnSameZone && pZone.name === targetZone.name) {
            violations.push({
              rule: 'workspace-deps',
              file: pkgFile,
              message: `zone "${pZone.name}" forbids depending on same zone: "${p.name}" cannot depend on "${dep}"`
            });
          } else if (pZone.name === 'core-modules' && targetZone.name === 'core-modules') {
            violations.push({
              rule: 'workspace-deps',
              file: pkgFile,
              message: `core-module "${p.name}" cannot depend on another core-module "${dep}" (Plan rule 2)`
            });
          } else if (!allowedCross && !mayDependOnZone) {
            violations.push({
              rule: 'workspace-deps',
              file: pkgFile,
              message: `zone "${pZone.name}" ("${p.name}") may not depend on zone "${targetZone.name}" ("${dep}")`
            });
          }
        } else if (p.kind === 'library' && target.kind === 'app') {
          violations.push({ rule: 'workspace-deps', file: pkgFile, message: `library depends on app "${dep}"; packages/ must never depend on apps/` });
        }
      }
    }
  }

  // Source scan
  for (const file of walk(root)) {
    const rel = toPosix(relative(root, file));
    if (rel.startsWith('scripts/architecture/')) continue;

    const fileZone = zones.length > 0
      ? zones.find((z) => rel.startsWith(z.pathPrefix))
      : undefined;

    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');

    if (fileZone && fileZone.name === 'core-ui') {
      if (/\bfetch\s*\(/.test(text) || /\bXMLHttpRequest\b/.test(text)) {
        violations.push({ rule: 'ui-purity', file: rel, message: 'core-ui components must be presentation only: network calls (fetch/XHR) are forbidden' });
      }
    }

    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1]!;
      const fullMatch = m[0]!;
      const line = text.slice(0, m.index).split('\n').length;

      if (spec.startsWith('.')) {
        const targetAbs = resolve(join(root, rel, '..'), spec);
        const targetRel = toPosix(relative(root, targetAbs));
        if (rel.startsWith('core/') && targetRel.startsWith('hub/')) {
          violations.push({ rule: 'workspace-deps', file: rel, line, message: `relative import "${spec}" escapes core/ into hub/` });
        } else if (rel.startsWith('hub/') && targetRel.startsWith('core/')) {
          violations.push({ rule: 'workspace-deps', file: rel, line, message: `relative import "${spec}" escapes hub/ into core/` });
        }
      }

      if (rel.startsWith('core/')) {
        if (spec.startsWith('@platform-hub/') && spec !== '@platform-hub/contracts') {
          violations.push({ rule: 'workspace-deps', file: rel, line, message: `core may not import "${spec}"; only @platform-hub/contracts is allowed` });
        }
      }

      if (fileZone && fileZone.name === 'core-ui') {
        if ((spec.startsWith('@platform-core/') || spec.startsWith('@platform-sdk/')) && !TYPE_ONLY_IMPORT_RE.test(fullMatch)) {
          violations.push({ rule: 'ui-purity', file: rel, line, message: `core-ui cannot import runtime package "${spec}"; only type imports are allowed` });
        }
      }

      for (const group of config.sdkGroups) {
        if (matchSdk(spec, group.packages)) {
          const isAllowedInZone = fileZone && fileZone.sdkGroupsAllowed?.includes(group.name);
          const isAllowedPathMatch = group.allowedPaths && group.allowedPaths.some((a) => isAllowedPath(rel, [a]));
          if (!isAllowedInZone && !isAllowedPathMatch) {
            violations.push({ rule: 'provider-sdk', file: rel, line, message: `imports ${group.name} SDK "${spec}"; allowed only in designated zones/paths` });
          }
        }
      }
    }

    if (config.permissionChecks && !isTestFile(rel)) {
      lines.forEach((l, i) => {
        if (/arch-check:\s*allow-role-name/.test(l) || /arch-check:\s*allow-role-name/.test(lines[i - 1] ?? '')) return;
        for (const { re, why } of PERMISSION_PATTERNS) {
          if (re.test(l)) {
            violations.push({ rule: 'permission-check', file: rel, line: i + 1, message: `${why}; code must check permission keys` });
            break;
          }
        }
      });
    }
  }

  return violations;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const root = process.cwd();
  const violations = check(root);
  if (violations.length > 0) {
    console.error(`Architecture check failed with ${violations.length} violation(s):\n`);
    for (const v of violations) {
      console.error(`  [${v.rule}] ${v.file}${v.line ? `:${v.line}` : ''} - ${v.message}`);
    }
    process.exit(1);
  }
  console.log('architecture check: OK');
}
