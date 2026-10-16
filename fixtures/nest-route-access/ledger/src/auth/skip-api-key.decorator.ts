import { SetMetadata } from '@nestjs/common';

export const SKIP_API_KEY = 'skipApiKey';

/** Switches `ApiKeyGuard` off for one handler; not a word that says "public". */
export function SkipApiKey() {
  return SetMetadata(SKIP_API_KEY, true);
}
