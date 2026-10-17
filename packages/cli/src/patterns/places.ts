import { join } from 'node:path';
import {
  resolveTypeOrigin,
  startLineOf,
  statedOrigin,
  type LoadedConfig,
  type ServiceConfig,
  type Unresolved,
} from '@flowatlas/core';
import { createRepoProject } from '@flowatlas/extractor-nestjs';
import { Node, type CallExpression, type Decorator, type Node as TsNode, type Project } from 'ts-morph';

/**
 * Places of the source a pattern is held against, opened read-only (P121).
 *
 * `explain` and `suggest` both start from a place the reader could not follow
 * - a file and a line of a service - and need the call written there, with
 * the type its receiver has as the reader would name it. The service is
 * opened the way its reader opens it, stand-ins included, and nothing is
 * written.
 */

export interface Place {
  readonly service: string;
  /** Repository-relative, as rows name it. */
  readonly file: string;
  readonly line: number;
  readonly symbol?: string;
}

/** The type a receiver has, as a reader names it: the checker's, or what the source states. */
export const receiverTypeOf = (receiver: TsNode): string | undefined => resolveTypeOrigin(receiver)?.typeName ?? statedOrigin(receiver)?.typeName;

/** The package a receiver's type is declared in, when one says. */
export const receiverPackageOf = (receiver: TsNode): string | undefined =>
  resolveTypeOrigin(receiver)?.package ?? statedOrigin(receiver)?.package ?? undefined;

/** Projects opened once per command, by service. */
export class ServiceSources {
  readonly #projects = new Map<string, Project>();

  constructor(private readonly loaded: LoadedConfig) {}

  service(name: string): ServiceConfig | undefined {
    return this.loaded.config.services.find((each) => each.name === name && each.document === undefined);
  }

  project(service: ServiceConfig): Project {
    let project = this.#projects.get(service.name);
    if (project === undefined) {
      project = createRepoProject({
        rootDir: this.loaded.repoDir(service),
        repo: service.name,
        service,
        config: this.loaded.config,
        configDir: this.loaded.rootDir,
      });
      this.#projects.set(service.name, project);
    }
    return project;
  }

  /** The calls and decorators that start on a place's line. */
  sitesAt(place: Place): Array<CallExpression | Decorator> {
    const service = this.service(place.service);
    if (service === undefined) return [];
    const source = this.project(service).getSourceFile(join(this.loaded.repoDir(service), place.file));
    if (source === undefined) return [];
    const sites: Array<CallExpression | Decorator> = [];
    source.forEachDescendant((node) => {
      if ((Node.isCallExpression(node) || Node.isDecorator(node)) && startLineOf(node) === place.line) sites.push(node);
    });
    return sites;
  }
}

/** Every place a row stands for: its own, and the samples a folded row keeps. */
export const placesOfRow = (row: Unresolved): Place[] => {
  const service = row.service ?? '';
  const places: Place[] = [{ service, file: row.file, line: row.line, ...(row.symbol === undefined ? {} : { symbol: row.symbol }) }];
  const causes = row.meta?.['causes'];
  if (Array.isArray(causes)) {
    for (const cause of causes as Array<{ samples?: Array<{ file: string; line: number; symbol?: string }> }>) {
      for (const sample of cause.samples ?? []) {
        places.push({ service, file: sample.file, line: sample.line, ...(sample.symbol === undefined ? {} : { symbol: sample.symbol }) });
      }
    }
  }
  // One place per line and what it calls: a row read back without its symbol
  // and its own sample are the same place, and the one that names it wins.
  const kept = new Map<string, Place>();
  for (const place of places) {
    const callee = place.symbol?.split(' -> ')[1] ?? '';
    const key = `${place.service}\0${place.file}\0${place.line}`;
    const same = [...kept.entries()].find(([at, each]) => at.startsWith(key) && (each.symbol === undefined || place.symbol === undefined || each.symbol.split(' -> ')[1] === callee));
    if (same === undefined) kept.set(`${key}\0${callee}`, place);
    else if (same[1].symbol === undefined && place.symbol !== undefined) kept.set(same[0], place);
  }
  return [...kept.values()];
};

/** The call a place's symbol names, among those on its line: `Class.method -> this.bus.emit`. */
export const siteNamed = (sites: readonly (CallExpression | Decorator)[], symbol: string | undefined): CallExpression | Decorator | undefined => {
  const callee = symbol?.split(' -> ')[1]?.trim();
  if (callee !== undefined) {
    const named = sites.find((site) => Node.isCallExpression(site) && site.getExpression().getText().replace(/\s+/g, '') === callee.replace(/\s+/g, ''));
    if (named !== undefined) return named;
  }
  return sites[0];
};
