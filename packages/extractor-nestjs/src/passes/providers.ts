import type { ClassDeclaration } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import type { IndexedClass } from '../index-classes.js';
import { readMarkers } from '../util/markers.js';
import { definePass } from './types.js';

/** Methods worth a node: the ones another method could call or a route could handle. */
const methodsOf = (declaration: ClassDeclaration) =>
  declaration.getMethods().filter((method) => method.getName() !== 'constructor');

/**
 * Classes the container manages, and their methods.
 *
 * A controller is a provider with `kind: controller` rather than a node type of
 * its own: it is a managed class with methods like any other, and the data model
 * has no separate kind for it.
 */
export const providersPass = definePass('providers', (ctx: NestExtractContext) => {
  const wanted = new Map<ClassDeclaration, IndexedClass>();

  for (const indexed of ctx.classes.all()) {
    if (indexed.role === 'controller' || indexed.role === 'injectable') {
      wanted.set(indexed.declaration, indexed);
    }
  }
  // A class can be registered as a provider without carrying the decorator.
  for (const info of ctx.modules.all()) {
    for (const provider of info.providers) {
      if (provider.declaration === undefined) continue;
      const indexed = ctx.classes.get(provider.declaration);
      if (indexed !== undefined) wanted.set(provider.declaration, indexed);
    }
  }

  for (const [declaration, indexed] of wanted) {
    ctx.ensureClassNode(declaration);
    for (const method of methodsOf(declaration)) {
      const node = ctx.ensureMethodNode(method);
      if (node === undefined) continue;
      const markers = readMarkers(method);
      if (markers.length > 0) {
        ctx.builder.addNode({ ...node, meta: { ...node.meta, markers } });
        node.meta = { ...node.meta, markers };
      }
    }
    const classMarkers = readMarkers(declaration);
    if (classMarkers.length > 0) {
      const classNode = ctx.builder.getNode(indexed.id);
      if (classNode !== undefined) classNode.meta = { ...classNode.meta, markers: classMarkers };
    }
  }
});
