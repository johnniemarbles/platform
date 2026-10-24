import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppManifest, ModuleRegistry, Problem } from './types.ts';

const MODULE_CONCEPTS = new Set(['booking', 'appointment', 'contact', 'account', 'lead', 'listing']);

function parseSemver(v: string): [number, number, number] {
  const clean = v.startsWith('^') ? v.slice(1) : v;
  const parts = clean.split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function satisfies(requested: string, available: string): boolean {
  const [reqMaj, reqMin, reqPat] = parseSemver(requested);
  const [availMaj, availMin, availPat] = parseSemver(available);

  if (reqMaj !== availMaj) return false;

  if (reqMaj === 0) {
    if (reqMin !== availMin) return false;
    return availPat >= reqPat;
  }

  if (availMin > reqMin) return true;
  if (availMin === reqMin) return availPat >= reqPat;
  return false;
}

export function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

export function validateManifest(manifest: AppManifest, registry: ModuleRegistry): Problem[] {
  const problems: Problem[] = [];

  // 1, 2, 3: Modules validation
  const modules = manifest.modules || [];
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    if (!mod) continue;

    const regMod = registry.modules[mod.id];
    if (!regMod) {
      problems.push({
        level: 'error',
        path: `modules[${i}].id`,
        message: 'unknown module',
      });
      continue;
    }

    if (regMod.status === 'planned') {
      problems.push({
        level: 'error',
        path: `modules[${i}].id`,
        message: 'module not available yet',
      });
    } else if (regMod.status === 'library') {
      problems.push({
        level: 'warning',
        path: `modules[${i}].id`,
        message: "no HTTP routes yet; the app can't call it until routes exist",
      });
    }

    if (!satisfies(mod.version, regMod.contractVersion)) {
      problems.push({
        level: 'error',
        path: `modules[${i}].version`,
        message: 'contract version drift',
      });
    }
  }

  // 4, 5, 6: Entities validation
  const entities = manifest.entities || [];
  const seenEntityNames = new Set<string>();

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (!entity) continue;

    if (seenEntityNames.has(entity.name)) {
      problems.push({
        level: 'error',
        path: `entities[${i}].name`,
        message: `duplicate entity name '${entity.name}'`,
      });
    }
    seenEntityNames.add(entity.name);

    const snake = toSnakeCase(entity.name);
    const tableName = `app_${manifest.slug}_${snake}`;
    if (tableName.length > 63) {
      problems.push({
        level: 'error',
        path: `entities[${i}].name`,
        message: `table name '${tableName}' exceeds 63 characters (${tableName.length})`,
      });
    }

    if (MODULE_CONCEPTS.has(entity.name.toLowerCase())) {
      problems.push({
        level: 'warning',
        path: `entities[${i}].name`,
        message: 'this looks like module data; use the module instead of an app-owned entity',
      });
    }

    const fields = entity.fields || {};
    for (const [fieldName, field] of Object.entries(fields)) {
      if (field.enum !== undefined && field.type !== 'text') {
        problems.push({
          level: 'error',
          path: `entities[${i}].fields.${fieldName}.enum`,
          message: "enum only allowed on 'text' type",
        });
      }
      if (field.maxLength !== undefined && field.type !== 'text') {
        problems.push({
          level: 'error',
          path: `entities[${i}].fields.${fieldName}.maxLength`,
          message: "maxLength only allowed on 'text' type",
        });
      }
      if (field.min !== undefined && field.type !== 'integer' && field.type !== 'numeric') {
        problems.push({
          level: 'error',
          path: `entities[${i}].fields.${fieldName}.min`,
          message: "min only allowed on 'integer' or 'numeric' type",
        });
      }
      if (field.max !== undefined && field.type !== 'integer' && field.type !== 'numeric') {
        problems.push({
          level: 'error',
          path: `entities[${i}].fields.${fieldName}.max`,
          message: "max only allowed on 'integer' or 'numeric' type",
        });
      }
    }
  }

  // 7: Identity clients validation
  const envs = Object.keys(manifest.identityClients || {});
  const hasEnvWithClient = envs.length > 0 && envs.some((env) => (manifest.identityClients[env]?.length ?? 0) > 0);
  if (!hasEnvWithClient) {
    problems.push({
      level: 'error',
      path: 'identityClients',
      message: 'identityClients contains at least one environment',
    });
  }

  return problems;
}

export function validateStrict(options: {
  manifest: AppManifest;
  registry: ModuleRegistry;
  appDir: string;
  platformDir: string;
  now?: Date;
}): Problem[] {
  const problems: Problem[] = [];
  const now = options.now ?? new Date();
  const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;

  // 1. Deprecated modules with sunset within 60 days
  for (const modRef of options.manifest.modules) {
    const modDef = options.registry.modules[modRef.id];
    if (!modDef) continue;
    const [modMaj] = parseSemver(modRef.version);
    const versions = modDef.versions ?? [];
    for (const v of versions) {
      if (v.major === modMaj && v.status === 'deprecated') {
        if (v.sunset) {
          const sunsetDate = new Date(v.sunset);
          if (sunsetDate.getTime() - now.getTime() <= sixtyDaysMs) {
            problems.push({
              level: 'error',
              path: `modules[${modRef.id}]`,
              message: `module '${modRef.id}' major ${v.major} is deprecated with sunset ${v.sunset} (within 60 days)`,
            });
          }
        }
      }
    }
  }

  // 2. Committed link: platform dependencies
  const checkPkgDeps = (pkgPath: string, label: string) => {
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        for (const [depName, depVer] of Object.entries(allDeps)) {
          if (typeof depVer === 'string' && depVer.startsWith('link:')) {
            problems.push({
              level: 'error',
              path: `${label}.dependencies.${depName}`,
              message: `committed link: platform dependency found: ${depName} -> ${depVer}`,
            });
          }
        }
      } catch {}
    }
  };
  checkPkgDeps(resolve(options.appDir, 'package.json'), 'package.json');
  checkPkgDeps(resolve(options.appDir, 'apps/web/package.json'), 'apps/web/package.json');

  // 3. Installed @platform-sdk/* major differs from manifest module major
  const webPkgPath = resolve(options.appDir, 'apps/web/package.json');
  if (existsSync(webPkgPath)) {
    try {
      const webPkg = JSON.parse(readFileSync(webPkgPath, 'utf8'));
      const deps = { ...webPkg.dependencies, ...webPkg.devDependencies };
      for (const modRef of options.manifest.modules) {
        const modDef = options.registry.modules[modRef.id];
        if (!modDef || !modDef.sdkPackage) continue;
        const installedVer = deps[modDef.sdkPackage];
        if (installedVer && typeof installedVer === 'string' && !installedVer.startsWith('link:')) {
          const [installedMaj] = parseSemver(installedVer);
          const [manifestMaj] = parseSemver(modRef.version);
          if (installedMaj !== manifestMaj) {
            problems.push({
              level: 'error',
              path: `apps/web.dependencies.${modDef.sdkPackage}`,
              message: `installed ${modDef.sdkPackage} major (${installedMaj}) differs from manifest module major (${manifestMaj})`,
            });
          }
        }
      }
    } catch {}
  }

  // 4. Warning for modules where registry is ahead by one or more minors, with changelog lines
  for (const modRef of options.manifest.modules) {
    const modDef = options.registry.modules[modRef.id];
    if (!modDef) continue;
    const [manifestMaj, manifestMin] = parseSemver(modRef.version);
    const [regMaj, regMin] = parseSemver(modDef.contractVersion);
    if (regMaj === manifestMaj && regMin > manifestMin) {
      let missingNotes = '';
      const clPath = resolve(options.platformDir, `core/registry/changelog/${modRef.id}.md`);
      if (existsSync(clPath)) {
        const cl = readFileSync(clPath, 'utf8');
        missingNotes = ` Missing changelog:\n${cl.slice(0, 300)}...`;
      }
      problems.push({
        level: 'warning',
        path: `modules[${modRef.id}]`,
        message: `registry is ahead for module '${modRef.id}' (${modDef.contractVersion} vs ${modRef.version}).${missingNotes}`,
      });
    }
  }

  return problems;
}
