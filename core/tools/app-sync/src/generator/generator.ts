import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { validateManifest } from '../validate.ts';
import { loadRegistry } from '../registry.ts';
import { loadManifest } from '../manifest.ts';
import type { AppEntity, AppManifest, ModuleRegistry } from '../types.ts';
import {
  generateMigration,
  generateRouteFile,
  generateTestFile,
  generateClientFile,
  generateClientIndex,
  generateColumnDef,
  toSnakeCase,
  toCamelCase,
} from './templates.ts';

export interface GeneratorOptions {
  manifestPath: string;
  appDir?: string;
  platformRoot: string;
  link?: boolean;
}

export interface FileOperation {
  action: 'create' | 'update' | 'skip';
  path: string;
  content: string;
}

export interface GeneratorLockEntity {
  fields: Record<string, any>;
  migrationFiles: string[];
}

export interface GeneratorLock {
  manifestVersion: number;
  entities: Record<string, GeneratorLockEntity>;
  modules: string[];
}

const CUSTOM_MARKER = '// ---- CUSTOM (preserved by app-sync) ----';

export function mergePreservingCustom(newContent: string, existingContent: string): string {
  const customIdx = existingContent.indexOf(CUSTOM_MARKER);
  if (customIdx === -1) return newContent;
  const customSection = existingContent.slice(customIdx);

  const newCustomIdx = newContent.indexOf(CUSTOM_MARKER);
  const baseNew = newCustomIdx !== -1 ? newContent.slice(0, newCustomIdx) : newContent;
  return baseNew + customSection;
}

export function planGenerator(options: GeneratorOptions): {
  operations: FileOperation[];
  lock: GeneratorLock;
  manifest: AppManifest;
} {
  const { manifestPath, appDir, platformRoot } = options;
  const registry = loadRegistry(platformRoot);
  const manifest = loadManifest(manifestPath, platformRoot);

  const problems = validateManifest(manifest, registry);
  const errors = problems.filter((p) => p.level === 'error');
  if (errors.length > 0) {
    throw new Error(`Validation failed:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
  }

  const slug = manifest.slug;
  const slugWithUnderscores = slug.replace(/-/g, '_');
  const packDir = resolve(platformRoot, 'core/app-packs', slug);
  const lockFilePath = resolve(packDir, '.app-sync.lock.json');

  let lock: GeneratorLock = {
    manifestVersion: manifest.manifestVersion,
    entities: {},
    modules: [],
  };

  if (existsSync(lockFilePath)) {
    try {
      lock = JSON.parse(readFileSync(lockFilePath, 'utf8'));
    } catch {
      // fresh lock
    }
  }

  // Refusal checks against lock
  for (const [entityName, lockEntity] of Object.entries(lock.entities)) {
    const currentEntity = manifest.entities.find((e) => e.name === entityName);
    if (!currentEntity) {
      throw new Error(`removed entity '${entityName}'; manual migration required`);
    }

    for (const [fieldName, lockField] of Object.entries(lockEntity.fields)) {
      const currentField = currentEntity.fields[fieldName];
      if (!currentField) {
        throw new Error(`removed field '${fieldName}' from entity '${entityName}'; manual migration required`);
      }
      if (currentField.type !== lockField.type) {
        throw new Error(`retyped field '${fieldName}' in entity '${entityName}'; manual migration required`);
      }
    }

    for (const [fieldName, currentField] of Object.entries(currentEntity.fields)) {
      if (!lockEntity.fields[fieldName] && currentField.required) {
        throw new Error(`new required field '${fieldName}' in entity '${entityName}' must have a default`);
      }
    }
  }

  const operations: FileOperation[] = [];

  function addOp(filePath: string, content: string, preserveCustom = false) {
    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf8');
      const finalContent = preserveCustom ? mergePreservingCustom(content, existing) : content;
      if (existing === finalContent) {
        operations.push({ action: 'skip', path: filePath, content: finalContent });
      } else {
        operations.push({ action: 'update', path: filePath, content: finalContent });
      }
    } else {
      operations.push({ action: 'create', path: filePath, content });
    }
  }

  // 1. App pack files
  const packPackageJson = JSON.stringify(
    {
      name: `@platform-app-packs/${slug}`,
      version: '0.1.0',
      private: true,
      type: 'module',
      exports: {
        '.': './src/index.ts',
      },
      scripts: {
        test: 'node --experimental-strip-types --no-warnings --test test/*.test.ts',
        typecheck: 'tsc --noEmit',
      },
      dependencies: {
        '@platform-core/route-kit': 'workspace:*',
        '@platform-hub/contracts': 'workspace:*',
      },
      devDependencies: {
        '@types/node': '^22.13.5',
        typescript: '^5.7.3',
      },
    },
    null,
    2
  ) + '\n';
  addOp(resolve(packDir, 'package.json'), packPackageJson);

  const packTsconfig = JSON.stringify(
    {
      compilerOptions: {
        target: 'ESNext',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['es2022'],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        allowImportingTsExtensions: true,
        noEmit: true,
      },
      include: ['src/**/*', 'test/**/*'],
    },
    null,
    2
  ) + '\n';
  addOp(resolve(packDir, 'tsconfig.json'), packTsconfig);

  const readPerms = manifest.entities.map((e) => `${slugWithUnderscores}.${toSnakeCase(e.name)}.read`);
  const writePerms = manifest.entities.flatMap((e) => [
    `${slugWithUnderscores}.${toSnakeCase(e.name)}.read`,
    `${slugWithUnderscores}.${toSnakeCase(e.name)}.write`,
  ]);

  const appJson = JSON.stringify(
    {
      appId: manifest.appId,
      slug: manifest.slug,
      displayName: manifest.displayName,
      bundles: {
        'records-read': {
          description: `Read all ${manifest.displayName} records`,
          permissions: readPerms.map((key) => ({ key, since: '0.1.0', autoGrant: true })),
        },
        'records-write': {
          description: `Write all ${manifest.displayName} records`,
          permissions: writePerms.map((key) => ({ key, since: '0.1.0', autoGrant: true })),
        },
      },
      identityClients: manifest.identityClients,
    },
    null,
    2
  ) + '\n';
  addOp(resolve(packDir, 'app.json'), appJson);

  // roles.json
  const rolesJsonPath = resolve(packDir, 'roles.json');
  let rolesTemplate: any = {
    roles: {
      owner: {
        displayName: 'Owner',
        bundles: ['platform.member', 'platform.admin', `${slug}.records-write`],
      },
      staff: {
        displayName: 'Staff',
        bundles: ['platform.member', `${slug}.records-write`],
      },
      viewer: {
        displayName: 'Viewer',
        bundles: ['platform.member', `${slug}.records-read`],
      },
    },
  };

  if (existsSync(rolesJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(rolesJsonPath, 'utf8'));
      if (parsed.roles) {
        rolesTemplate = parsed;
      }
    } catch {
      // use default
    }
  }

  if (!rolesTemplate.roles.owner) {
    rolesTemplate.roles.owner = { displayName: 'Owner', bundles: [] };
  }
  if (!rolesTemplate.roles.staff) {
    rolesTemplate.roles.staff = { displayName: 'Staff', bundles: [] };
  }
  if (!rolesTemplate.roles.viewer) {
    rolesTemplate.roles.viewer = { displayName: 'Viewer', bundles: [] };
  }

  const addBundle = (roleName: string, b: string) => {
    if (!rolesTemplate.roles[roleName].bundles.includes(b)) {
      rolesTemplate.roles[roleName].bundles.push(b);
    }
  };

  addBundle('owner', 'platform.member');
  addBundle('owner', 'platform.admin');
  addBundle('owner', `${slug}.records-write`);

  addBundle('staff', 'platform.member');
  addBundle('staff', `${slug}.records-write`);

  addBundle('viewer', 'platform.member');
  addBundle('viewer', `${slug}.records-read`);

  for (const modRef of manifest.modules) {
    const regMod = registry.modules[modRef.id];
    if (!regMod || !regMod.bundles) continue;
    for (const bundleName of Object.keys(regMod.bundles)) {
      const bundleKey = `${modRef.id}.${bundleName}`;
      addBundle('owner', bundleKey);
      if (!bundleName.endsWith('manager') && !bundleName.endsWith('admin')) {
        addBundle('staff', bundleKey);
      }
    }
  }

  addOp(rolesJsonPath, JSON.stringify(rolesTemplate, null, 2) + '\n');

  // Entities code & migrations
  const managedEntities = manifest.entities.filter((e) => e.managed !== false);
  const routeImports: string[] = [];
  const routeCalls: string[] = [];

  for (const entity of managedEntities) {
    const entitySnake = toSnakeCase(entity.name);
    const migrationName = `0001_create_app_${slugWithUnderscores}_${entitySnake}.sql`;
    const migrationPath = resolve(packDir, 'migrations', migrationName);

    const existingMigrations = lock.entities[entity.name]?.migrationFiles ?? [];
    if (existingMigrations.length === 0) {
      const migrationContent = generateMigration(manifest, entity, 1);
      addOp(migrationPath, migrationContent);
    } else {
      // Check for newly added fields
      const lockedFields = lock.entities[entity.name]?.fields ?? {};
      const newFieldEntries = Object.entries(entity.fields).filter(([fname]) => !lockedFields[fname]);
      for (const [newFieldName, newField] of newFieldEntries) {
        const nextNum = String(existingMigrations.length + 1).padStart(4, '0');
        const colName = toSnakeCase(newFieldName);
        const alterMigrationName = `${nextNum}_alter_app_${slugWithUnderscores}_${entitySnake}_add_${colName}.sql`;
        const alterMigrationPath = resolve(packDir, 'migrations', alterMigrationName);
        const alterContent = `-- @generated by app-sync from platform.app.json (entity: ${entity.name}).
BEGIN;
ALTER TABLE platform.app_${slugWithUnderscores}_${entitySnake}
  ADD COLUMN ${generateColumnDef(colName, newField)};
COMMIT;
`;
        addOp(alterMigrationPath, alterContent);
      }
    }

    const routePath = resolve(packDir, 'src/routes', `${entity.name}.ts`);
    const routeContent = generateRouteFile(manifest, entity);
    addOp(routePath, routeContent, true);

    const testPath = resolve(packDir, 'test', `${entity.name}.test.ts`);
    const testContent = generateTestFile(manifest, entity);
    addOp(testPath, testContent, true);

    routeImports.push(`import { ${entity.name}Routes } from './routes/${entity.name}.ts';`);
    routeCalls.push(`    ...${entity.name}Routes(),`);

    if (appDir) {
      const clientPath = resolve(appDir, 'apps/web/src/platform/generated', `${entity.name}.ts`);
      const clientContent = generateClientFile(manifest, entity);
      addOp(clientPath, clientContent);
    }
  }

  // Pack index.ts
  const packIndexContent = `// @generated by app-sync from platform.app.json. Edits above the CUSTOM marker are overwritten.
import type { RouteDefinition } from '@platform-core/route-kit';
${routeImports.join('\n')}

export const appId = '${manifest.appId}';

export function generatedRoutes(): RouteDefinition[] {
  return [
${routeCalls.join('\n')}
  ];
}

// ---- CUSTOM (preserved by app-sync) ----
export function routes(): RouteDefinition[] {
  return [...generatedRoutes()];
}
`;
  addOp(resolve(packDir, 'src/index.ts'), packIndexContent, true);

  if (appDir) {
    if (managedEntities.length > 0) {
      const clientIndexPath = resolve(appDir, 'apps/web/src/platform/generated/index.ts');
      const clientIndexContent = generateClientIndex(managedEntities);
      addOp(clientIndexPath, clientIndexContent);
    }

    // Module SDK packages & platform.modules block in apps/web/src/platform/index.ts
    const sdkModules: Array<{ id: string; sdkPackage: string; contractVersion: string; clientName: string }> = [];
    for (const m of manifest.modules) {
      const modDef = registry.modules[m.id];
      if (modDef && modDef.sdkPackage) {
        const clientName = `${toCamelCase(m.id)}Client`;
        sdkModules.push({
          id: m.id,
          sdkPackage: modDef.sdkPackage,
          contractVersion: modDef.contractVersion,
          clientName,
        });
      }
    }

    // 1. Update apps/web/package.json dependencies
    const webPkgPath = resolve(appDir, 'apps/web/package.json');
    if (existsSync(webPkgPath)) {
      const webPkg = JSON.parse(readFileSync(webPkgPath, 'utf8'));
      webPkg.dependencies = webPkg.dependencies || {};
      let changed = false;
      for (const sm of sdkModules) {
        const depVal = options.link
          ? `link:${relative(resolve(appDir, 'apps/web'), resolve(platformRoot, 'core/sdk', sm.id))}`
          : `^${sm.contractVersion}`;
        if (webPkg.dependencies[sm.sdkPackage] !== depVal) {
          webPkg.dependencies[sm.sdkPackage] = depVal;
          changed = true;
        }
      }
      if (options.link && sdkModules.length > 0) {
        const transportVal = `link:${relative(resolve(appDir, 'apps/web'), resolve(platformRoot, 'core/sdk/transport'))}`;
        if (webPkg.dependencies['@platform-sdk/transport'] !== transportVal) {
          webPkg.dependencies['@platform-sdk/transport'] = transportVal;
          changed = true;
        }
      }
      if (changed) {
        addOp(webPkgPath, JSON.stringify(webPkg, null, 2) + '\n');
      }
    }

    // 2. Regenerate platform.modules block in apps/web/src/platform/index.ts
    const webPlatformIndexPath = resolve(appDir, 'apps/web/src/platform/index.ts');
    if (existsSync(webPlatformIndexPath) && sdkModules.length > 0) {
      const currentContent = readFileSync(webPlatformIndexPath, 'utf8');
      const BEGIN_MARKER = '// ---- BEGIN MODULES (generated by app-sync) ----';
      const END_MARKER = '// ---- END MODULES (generated by app-sync) ----';

      const importLines = sdkModules.map((sm) => `import { ${sm.clientName} } from '${sm.sdkPackage}';`).join('\n');
      const moduleAssignments = sdkModules.map((sm) => `  ${toCamelCase(sm.id)}: ${sm.clientName}(platform),`).join('\n');
      const newBlock = `${BEGIN_MARKER}\n${importLines}\n\nplatform.modules = {\n${moduleAssignments}\n};\n${END_MARKER}`;

      let updatedIndexContent: string;
      if (currentContent.includes(BEGIN_MARKER) && currentContent.includes(END_MARKER)) {
        const before = currentContent.slice(0, currentContent.indexOf(BEGIN_MARKER));
        const after = currentContent.slice(currentContent.indexOf(END_MARKER) + END_MARKER.length);
        updatedIndexContent = `${before}${newBlock}${after}`;
      } else {
        const platformMatch = currentContent.match(/export const platform = new PlatformApi\(\{[\s\S]*?\}\);/);
        if (platformMatch && platformMatch.index !== undefined) {
          const insertPos = platformMatch.index + platformMatch[0].length;
          updatedIndexContent = `${currentContent.slice(0, insertPos)}\n\n${newBlock}\n${currentContent.slice(insertPos)}`;
        } else {
          updatedIndexContent = `${currentContent}\n\n${newBlock}\n`;
        }
      }
      if (updatedIndexContent !== currentContent) {
        addOp(webPlatformIndexPath, updatedIndexContent);
      }
    }
  }

  // Update platform-api dependencies & app-packs.ts
  const platformApiDir = resolve(platformRoot, 'core/apps/platform-api');
  const platformApiPkgPath = resolve(platformApiDir, 'package.json');
  if (existsSync(platformApiPkgPath)) {
    const apiPkg = JSON.parse(readFileSync(platformApiPkgPath, 'utf8'));
    apiPkg.dependencies = apiPkg.dependencies || {};
    const depKey = `@platform-app-packs/${slug}`;
    if (!apiPkg.dependencies[depKey]) {
      apiPkg.dependencies[depKey] = 'workspace:*';
      addOp(platformApiPkgPath, JSON.stringify(apiPkg, null, 2) + '\n');
    }
  }

  // Re-generate app-packs.ts
  const appPacksTsPath = resolve(platformApiDir, 'src/app-packs.ts');
  const allAppPacksDirs = existsSync(resolve(platformRoot, 'core/app-packs'))
    ? readdirSync(resolve(platformRoot, 'core/app-packs')).filter((d) => !d.startsWith('.'))
    : [];
  if (!allAppPacksDirs.includes(slug)) allAppPacksDirs.push(slug);
  allAppPacksDirs.sort();

  const appPackImports = allAppPacksDirs.map((s) => `import * as ${s.replace(/-/g, '_')} from '@platform-app-packs/${s}';`).join('\n');
  const appPackExports = `export const appPacks = [${allAppPacksDirs.map((s) => s.replace(/-/g, '_')).join(', ')}] as const;\n`;
  const appPacksTsContent = `// @generated by app-sync. Lists every app pack platform-api serves.\n${appPackImports}\n\n${appPackExports}`;
  addOp(appPacksTsPath, appPacksTsContent);

  // Update CODEOWNERS
  const codeownersPath = resolve(platformRoot, '.github/CODEOWNERS');
  if (existsSync(codeownersPath)) {
    const codeowners = readFileSync(codeownersPath, 'utf8');
    const packLine = `/core/app-packs/${slug}/ @johnniemarbles`;
    if (!codeowners.includes(packLine)) {
      addOp(codeownersPath, `${codeowners.trimEnd()}\n${packLine}\n`);
    }
  }

  // Prepare new lock
  const newLock: GeneratorLock = {
    manifestVersion: manifest.manifestVersion,
    entities: {},
    modules: manifest.modules.map((m) => m.id),
  };
  for (const entity of managedEntities) {
    const entitySnake = toSnakeCase(entity.name);
    const existingMigrations = lock.entities[entity.name]?.migrationFiles ?? [];
    const migrationList = existingMigrations.length > 0 ? [...existingMigrations] : [`0001_create_app_${slugWithUnderscores}_${entitySnake}.sql`];
    const lockedFields = lock.entities[entity.name]?.fields ?? {};
    const newFieldEntries = Object.entries(entity.fields).filter(([fname]) => !lockedFields[fname]);
    if (existingMigrations.length > 0) {
      for (const [newFieldName] of newFieldEntries) {
        const nextNum = String(migrationList.length + 1).padStart(4, '0');
        const colName = toSnakeCase(newFieldName);
        migrationList.push(`${nextNum}_alter_app_${slugWithUnderscores}_${entitySnake}_add_${colName}.sql`);
      }
    }

    newLock.entities[entity.name] = {
      fields: JSON.parse(JSON.stringify(entity.fields)),
      migrationFiles: migrationList,
    };
  }

  return { operations, lock: newLock, manifest };
}

export function syncGenerator(options: GeneratorOptions): {
  created: string[];
  updated: string[];
  skipped: string[];
} {
  const { operations, lock, manifest } = planGenerator(options);
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const op of operations) {
    if (op.action === 'skip') {
      skipped.push(op.path);
      continue;
    }

    mkdirSync(dirname(op.path), { recursive: true });
    writeFileSync(op.path, op.content, 'utf8');

    if (op.action === 'create') {
      created.push(op.path);
    } else if (op.action === 'update') {
      updated.push(op.path);
    }
  }

  const packDir = resolve(options.platformRoot, 'core/app-packs', manifest.slug);
  mkdirSync(packDir, { recursive: true });
  writeFileSync(resolve(packDir, '.app-sync.lock.json'), JSON.stringify(lock, null, 2) + '\n', 'utf8');

  return { created, updated, skipped };
}
