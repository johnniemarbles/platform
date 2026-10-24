export type ModuleStatus = 'available' | 'library' | 'planned' | 'hub';

export interface BundlePermission {
  key: string;
  since: string;
  autoGrant?: boolean;
}

export interface ModuleBundle {
  description: string;
  permissions: BundlePermission[];
}

export interface ModuleVersion {
  major: number;
  status: 'current' | 'deprecated';
  sunset?: string | null;
}

export interface ModuleDefinition {
  status: ModuleStatus;
  package: string;
  contractVersion: string;
  summary: string;
  permissions: string[];
  bundles: Record<string, ModuleBundle>;
  sdkPackage?: string | null;
  versions?: ModuleVersion[];
  routes: string[];
  migrations: string[];
  uiKit: string | null;
  notes?: string;
}

export interface ModuleRegistry {
  $schema?: string;
  registryVersion: number;
  modules: Record<string, ModuleDefinition>;
}

export interface EntityField {
  type: 'text' | 'integer' | 'numeric' | 'boolean' | 'date' | 'timestamptz' | 'uuid' | 'jsonb' | 'text[]';
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  enum?: string[];
}

export interface AppEntity {
  name: string;
  cardinality: 'one-per-person' | 'many';
  managed?: boolean;
  description?: string;
  fields: Record<string, EntityField>;
}

export interface IdentityClient {
  provider: 'cognito' | 'dev';
  poolId: string;
  clientId: string;
}

export interface AppManifest {
  manifestVersion: number;
  appId: string;
  slug: string;
  displayName: string;
  modules: Array<{ id: string; version: string }>;
  entities: AppEntity[];
  identityClients: Record<string, IdentityClient[]>;
}

export interface Problem {
  level: 'error' | 'warning';
  path: string;
  message: string;
}
