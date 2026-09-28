/**
 * A notification service's `github-skill-bundle.ts` in miniature (R156): module-level functions,
 * no class, no provider, and no entry point naming any of them.
 */

/** Holds a leaf: it reads configuration. */
export const buildGithubHeaders = (): { authorization?: string } => ({
  authorization: process.env.GITHUB_API_TOKEN,
});

/** Holds nothing and reaches nothing: a pure helper. */
export const mapGithubError = (status: number): Error => new Error(`GitHub answered ${status}`);

/** Holds nothing and reaches nothing either. */
export const repoSlug = (repository: string): string => repository.trim().toLowerCase();

/** Holds a leaf, a request, and calls a function that holds another. */
export async function streamTarball(slug: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${slug}/tarball`, {
    headers: buildGithubHeaders(),
  });
  if (!response.ok) throw mapGithubError(response.status);
  return response.text();
}

/** Holds nothing itself, and calls a function that does. */
export async function fetchSkillBundle(slug: string): Promise<string> {
  return streamTarball(slug);
}

/** Holds nothing, nothing calls it, and it still reaches a leaf. */
export function isGithubConfigured(): boolean {
  return buildGithubHeaders().authorization !== undefined;
}
