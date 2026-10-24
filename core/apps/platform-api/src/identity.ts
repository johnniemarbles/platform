import type { IdentityVerifier } from '@platform-core/iam';
import { DevIdentityVerifier } from '@platform-core/iam-dev';

export function identityFromEnv(): IdentityVerifier {
  const provider = process.env['IDENTITY_PROVIDER'] ?? 'dev';
  if (provider === 'cognito') {
    // When AWS reconnects and iam-cognito lands, instantiate CognitoIdentityVerifier here.
    throw new Error('IDENTITY_PROVIDER=cognito is not yet configured in staging environment');
  }
  if (provider !== 'dev') throw new Error(`unknown IDENTITY_PROVIDER: ${provider}`);
  const secret = process.env['DEV_IDENTITY_SECRET'];
  if (!secret) throw new Error('DEV_IDENTITY_SECRET required when IDENTITY_PROVIDER=dev');
  return new DevIdentityVerifier({ secret });
}
