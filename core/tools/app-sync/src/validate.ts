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
