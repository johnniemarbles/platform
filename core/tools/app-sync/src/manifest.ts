import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import type { AppManifest } from './types.ts';

export function loadManifest(manifestPath: string, platformRoot?: string): AppManifest {
  const resolvedManifestPath = resolve(manifestPath);
  if (!existsSync(resolvedManifestPath)) {
    throw new Error(`App manifest not found at ${resolvedManifestPath}`);
  }

  const schemaPath = platformRoot
    ? resolve(platformRoot, 'core/registry/app-manifest.schema.json')
    : resolve(import.meta.dirname, '../../registry/app-manifest.schema.json');

  if (!existsSync(schemaPath)) {
    throw new Error(`App manifest schema not found at ${schemaPath}`);
  }

  const rawJson = JSON.parse(readFileSync(resolvedManifestPath, 'utf8'));
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(rawJson);

  if (!valid) {
    const errors = (validate.errors as ErrorObject[] | undefined)
      ?.map((e: ErrorObject) => `${e.instancePath || '/'}: ${e.message}`)
      .join(', ');
    throw new Error(`Invalid manifest ${manifestPath}: ${errors}`);
  }

  return rawJson as AppManifest;
}

