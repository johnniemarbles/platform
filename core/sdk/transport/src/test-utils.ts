export function assertShape(
  value: any,
  schema: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'any'>
): void {
  if (!value || typeof value !== 'object') {
    throw new Error(`expected object, got ${typeof value}`);
  }
  for (const [k, expectedType] of Object.entries(schema)) {
    const actual = value[k];
    if (expectedType === 'any') continue;
    if (expectedType === 'null') {
      if (actual !== null && actual !== undefined) {
        throw new Error(`expected null at ${k}, got ${typeof actual}`);
      }
    } else if (expectedType === 'array') {
      if (!Array.isArray(actual)) {
        throw new Error(`expected array at ${k}, got ${typeof actual}`);
      }
    } else {
      if (typeof actual !== expectedType) {
        throw new Error(`expected ${expectedType} at ${k}, got ${typeof actual}`);
      }
    }
  }
}
