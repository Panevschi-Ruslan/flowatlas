import { parse } from 'yaml';

/** One image a Skaffold configuration builds with Docker (P331). */
export interface SkaffoldArtifact {
  /** The image's own name, without registry, path or tag. */
  readonly name: string;
  /** As written, relative to the configuration's directory. */
  readonly context: string;
  /** As written, relative to the context. */
  readonly dockerfile: string;
  readonly target?: string;
  readonly args: Readonly<Record<string, string>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const scalar = (value: unknown): string | undefined => (typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined);

/** An artifact's own name: `registry.example.test/shop/orders` is `orders`. */
const ownName = (image: string): string => (image.split('/').pop() ?? image).split(/[:@]/)[0]?.toLowerCase() ?? '';

const artifactsOf = (build: unknown): SkaffoldArtifact[] => {
  if (!isRecord(build) || !Array.isArray(build['artifacts'])) return [];
  return build['artifacts'].filter(isRecord).flatMap((artifact) => {
    const image = scalar(artifact['image']);
    if (image === undefined || image.includes('{{') || image.includes('$')) return [];
    const docker = isRecord(artifact['docker']) ? artifact['docker'] : {};
    // Another builder (Jib, Buildpacks, Bazel, Ko) writes no Dockerfile.
    if (['jib', 'buildpacks', 'bazel', 'ko', 'custom'].some((other) => artifact[other] !== undefined)) return [];
    const args: Record<string, string> = {};
    if (isRecord(docker['buildArgs'])) {
      for (const [name, value] of Object.entries(docker['buildArgs'])) {
        const text = scalar(value);
        if (text !== undefined && !text.includes('{{')) args[name] = text;
      }
    }
    const target = scalar(docker['target']);
    return [{ name: ownName(image), context: scalar(artifact['context']) ?? '.', dockerfile: scalar(docker['dockerfile']) ?? 'Dockerfile', ...(target === undefined ? {} : { target }), args }];
  });
};

/**
 * The images a Skaffold configuration builds (P331), so a cluster's workload
 * running one is read with the environment its Dockerfile gives: each
 * artifact of `build.artifacts`, and of each profile's, with its image's
 * name, its context (`.` where none is written), and its Docker builder's
 * Dockerfile (`Dockerfile` where none is named), target and build arguments.
 * Every document of a file of several (`---`) is read. Nothing for a file
 * that is not one.
 */
export const readSkaffoldFile = (text: string): SkaffoldArtifact[] => {
  const out: SkaffoldArtifact[] = [];
  let documents: unknown[];
  try {
    documents = text
      .split(/^---\s*$/m)
      .map((part) => parse(part, { logLevel: 'silent' }) as unknown);
  } catch {
    return [];
  }
  for (const document of documents) {
    if (!isRecord(document)) continue;
    out.push(...artifactsOf(document['build']));
    for (const profile of Array.isArray(document['profiles']) ? document['profiles'].filter(isRecord) : []) out.push(...artifactsOf(profile['build']));
  }
  return out;
};
