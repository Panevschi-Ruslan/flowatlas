export { DigestFeed } from './digest-feed';
export { TeamFeed } from './team-feed';

interface Env {
  DIGESTS: DurableObjectNamespace;
  TEAM_FEEDS: DurableObjectNamespace;
}

/**
 * The worker's own fetch hands each stream to an object. Each branch whose
 * test names a path is a route; the last one's test names none.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/digest/stream') {
      return env.DIGESTS.get(env.DIGESTS.idFromName('daily')).fetch(request);
    }
    const team = url.pathname.match(/^\/teams\/([^/]+)\/feed$/);
    if (team) {
      return env.TEAM_FEEDS.getByName(team[1]).fetch(request);
    }
    if (url.pathname.endsWith('/watch')) {
      return env.DIGESTS.get(env.DIGESTS.idFromName('watch')).fetch(request);
    }
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
