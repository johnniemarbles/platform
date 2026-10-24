import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DeprecationInfo {
  readonly sunset: string | null;
  readonly link: string;
}

export interface ModuleVersion {
  readonly major: number;
  readonly status: 'current' | 'deprecated';
  readonly sunset?: string | null;
}

export interface ModuleDef {
  readonly routes?: string[];
  readonly versions?: ModuleVersion[];
}

export class DeprecationRegistry {
  private readonly map = new Map<string, DeprecationInfo>();

  constructor(rootDir?: string) {
    const root = rootDir ?? resolve(import.meta.dirname, '../../../..');
    const modulesJsonPath = resolve(root, 'core/registry/modules.json');
    if (!existsSync(modulesJsonPath)) return;

    try {
      const data = JSON.parse(readFileSync(modulesJsonPath, 'utf8'));
      const modules: Record<string, ModuleDef> = data.modules ?? {};

      for (const [modId, mod] of Object.entries(modules)) {
        const versions = mod.versions ?? [];
        const routes = mod.routes ?? [];

        for (const v of versions) {
          if (v.status === 'deprecated') {
            const majorPrefix = `/v${v.major}/`;
            const changelogUrl = `https://github.com/johnniemarbles/platform/blob/main/core/registry/changelog/${modId}.md`;

            for (const r of routes) {
              const parts = r.split(' ');
              const method = parts.length > 1 ? parts[0]! : 'GET';
              const path = parts.length > 1 ? parts[1]! : parts[0]!;

              if (path.startsWith(majorPrefix)) {
                this.map.set(`${method} ${path}`, {
                  sunset: v.sunset ?? null,
                  link: changelogUrl,
                });
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[deprecation] Failed to parse modules.json for deprecations:', e);
    }
  }

  getDeprecation(method: string, path: string): DeprecationInfo | undefined {
    return this.map.get(`${method} ${path}`);
  }
}
