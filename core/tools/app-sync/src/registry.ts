import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import type { ModuleRegistry } from './types.ts';

export function loadRegistry(platformRoot: string): ModuleRegistry {
  const jsonPath = resolve(platformRoot, 'core/registry/modules.json');
  const schemaPath = resolve(platformRoot, 'core/registry/modules.schema.json');

  if (!existsSync(jsonPath)) {
    throw new Error(`Module registry not found at ${jsonPath}`);
  }
  if (!existsSync(schemaPath)) {
    throw new Error(`Module registry schema not found at ${schemaPath}`);
  }

  const rawJson = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(rawJson);

  if (!valid) {
    const errors = (validate.errors as ErrorObject[] | undefined)
      ?.map((e: ErrorObject) => `${e.instancePath || '/'}: ${e.message}`)
      .join(', ');
    throw new Error(`Invalid modules.json: ${errors}`);
  }

  return rawJson as ModuleRegistry;
}

