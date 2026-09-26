import { VersioningType, type INestApplication } from '@nestjs/common';

/**
 * Where this service says what its addresses look like.
 *
 * Two calls, and between them they decide all four of the entries this
 * repository has. Neither is in the entry file and neither is reachable by
 * following calls out of it in the repositories this shape came from — immich
 * forks its API worker by path, novu reaches its own bootstrap through a dynamic
 * import inside a callback — so the reader looks for these two calls anywhere in
 * the repository, and adopts what it finds only when nothing disagrees.
 */
export async function configure(app: INestApplication): Promise<void> {
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'v',
    defaultVersion: '1',
  });
}
