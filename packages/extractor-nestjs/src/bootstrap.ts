import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Project, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import { decoratorArgs, evaluateExpression, type StaticValue } from '@flowatlas/core';
import { resolveCallableRef, resolveClassExpression, type ClassRef } from './util/resolve-class.js';

/** The four wrapping layers, in the order the framework runs them. */
export const WRAPPING_LAYERS = ['middleware', 'guard', 'interceptor', 'pipe'] as const;

export type WrappingLayer = (typeof WRAPPING_LAYERS)[number];

/** A wrapper named somewhere, together with any arguments that configure it. */
export interface WrapperRef {
  ref: ClassRef;
  /** Arguments of a factory call such as a strategy name. */
  factoryArgs?: unknown[];
  line: number;
  text: string;
}

export interface BootstrapGlobal {
  layer: WrappingLayer;
  wrapper: WrapperRef;
}

export interface BootstrapInfo {
  /** Repo-relative path of the file that was read, when one was found. */
  file?: string;
  found: boolean;
  globalPrefix?: string;
  /** Literal paths excluded from the global prefix. */
  globalPrefixExcludes: string[];
  /** True when the exclude list could not be read statically. */
  globalPrefixExcludesDynamic: boolean;
  globals: BootstrapGlobal[];
  /** Call sites that name a wrapper the analysis could not follow. */
  dynamicGlobals: Array<{ layer: WrappingLayer; line: number; text: string }>;
}

const GLOBAL_METHODS: Record<string, WrappingLayer> = {
  useGlobalGuards: 'guard',
  useGlobalInterceptors: 'interceptor',
  useGlobalPipes: 'pipe',
};

export const BOOTSTRAP_CANDIDATES = ['src/main.ts', 'main.ts', 'src/index.ts'] as const;

export const findBootstrapFile = (rootDir: string, bootstrap?: string): string | undefined => {
  const candidates = bootstrap === undefined ? BOOTSTRAP_CANDIDATES : [bootstrap];
  for (const candidate of candidates) {
    const path = candidate.startsWith('/') ? candidate : join(rootDir, candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
};

/**
 * Reads one wrapper argument.
 *
 * `new AuthGuard('jwt')` names a class and configures it, and the configuration
 * matters: two strategies of the same guard class behave differently, so the
 * arguments travel with the reference.
 */
const readWrapper = (argument: Node): WrapperRef | undefined => {
  const line = argument.getStartLineNumber();
  const text = argument.getText();

  if (Node.isNewExpression(argument)) {
    const ref = resolveClassExpression(argument.getExpression());
    if (ref.kind === 'unknown') return undefined;
    const args = argument.getArguments().map((item) => evaluateExpression(item));
    const factoryArgs = args.every((value: StaticValue) => value.resolved)
      ? args.map((value) => (value.resolved ? value.value : undefined))
      : undefined;
    return {
      ref,
      ...(factoryArgs !== undefined && factoryArgs.length > 0 ? { factoryArgs } : {}),
      line,
      text,
    };
  }

  if (Node.isCallExpression(argument)) {
    const callee = argument.getExpression();
    // `app.get(SomeGuard)` asks the container for an instance of a named class.
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'get') {
      const [first] = argument.getArguments();
      if (first !== undefined) {
        const ref = resolveClassExpression(first);
        if (ref.kind !== 'unknown') return { ref, line, text };
      }
      return undefined;
    }
    const ref = resolveCallableRef(callee);
    if (ref.kind === 'unknown') return undefined;
    const args = argument.getArguments().map((item) => evaluateExpression(item));
    const factoryArgs = args.every((value: StaticValue) => value.resolved)
      ? args.map((value) => (value.resolved ? value.value : undefined))
      : undefined;
    return {
      ref,
      ...(factoryArgs !== undefined && factoryArgs.length > 0 ? { factoryArgs } : {}),
      line,
      text,
    };
  }

  const ref = resolveClassExpression(argument);
  return ref.kind === 'unknown' ? undefined : { ref, line, text };
};

const readGlobalPrefix = (
  call: import('ts-morph').CallExpression,
  info: BootstrapInfo,
): void => {
  const [pathArg, optionsArg] = call.getArguments();
  if (pathArg === undefined) return;
  const value = evaluateExpression(pathArg);
  if (value.resolved && typeof value.value === 'string') {
    info.globalPrefix = value.value;
  }
  if (optionsArg === undefined) return;
  const options = evaluateExpression(optionsArg);
  if (!options.resolved || typeof options.value !== 'object' || options.value === null) {
    info.globalPrefixExcludesDynamic = true;
    return;
  }
  const exclude = (options.value as { exclude?: unknown }).exclude;
  if (exclude === undefined) return;
  if (Array.isArray(exclude) && exclude.every((item) => typeof item === 'string')) {
    info.globalPrefixExcludes = exclude as string[];
    return;
  }
  info.globalPrefixExcludesDynamic = true;
};

/**
 * Reads the application entry file.
 *
 * Only the named file is read. Searching the repository for whatever creates the
 * application is slow and, in a project with more than one entry point, picks the
 * wrong one silently.
 */
export const readBootstrap = (
  project: Project,
  absolutePath: string | undefined,
  relativePath: string | undefined,
): BootstrapInfo => {
  const info: BootstrapInfo = {
    found: false,
    globalPrefixExcludes: [],
    globalPrefixExcludesDynamic: false,
    globals: [],
    dynamicGlobals: [],
  };
  if (absolutePath === undefined) return info;

  let sourceFile: SourceFile | undefined = project.getSourceFile(absolutePath);
  if (sourceFile === undefined) {
    try {
      sourceFile = project.addSourceFileAtPath(absolutePath);
    } catch {
      return info;
    }
  }
  info.found = true;
  if (relativePath !== undefined) info.file = relativePath;

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    const name = callee.getName();

    if (name === 'setGlobalPrefix') {
      readGlobalPrefix(node, info);
      return;
    }
    const layer = GLOBAL_METHODS[name];
    if (layer === undefined) return;
    for (const argument of node.getArguments()) {
      const wrapper = readWrapper(argument);
      if (wrapper === undefined) {
        info.dynamicGlobals.push({
          layer,
          line: argument.getStartLineNumber(),
          text: argument.getText(),
        });
        continue;
      }
      info.globals.push({ layer, wrapper });
    }
  });

  return info;
};

export { decoratorArgs };
