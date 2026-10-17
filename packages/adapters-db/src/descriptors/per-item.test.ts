import { Project, SyntaxKind, type CallExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { mongodbDescriptor, mongooseDescriptor, prismaDescriptor, sequelizeDescriptor, typeormDescriptor, localBaseDescriptor } from './index.js';
import { perItemMetaOf } from './per-item.js';

/** The outermost call of a snippet's last statement: the end of a chain written last. */
const callIn = (text: string): CallExpression => {
  const source = new Project({ useInMemoryFileSystem: true }).createSourceFile('q.ts', text);
  const call = source.getStatements().at(-1)?.getFirstDescendantByKind(SyntaxKind.CallExpression);
  if (call === undefined) throw new Error('no call');
  return call;
};

describe('a batch, by the descriptor (P89)', () => {
  it.each([
    [mongodbDescriptor, 'insertMany'],
    [mongodbDescriptor, 'bulkWrite'],
    [mongooseDescriptor, 'updateMany'],
    [prismaDescriptor, 'createMany'],
    [sequelizeDescriptor, 'bulkCreate'],
    [localBaseDescriptor, 'bulkUpsert'],
    [localBaseDescriptor, 'saveMany'],
  ])('%s.%s takes many items in one round trip', (descriptor, method) => {
    expect(perItemMetaOf(descriptor, method, callIn('x.y()'), 'write')).toEqual({ batch: true });
  });

  it('does not take a single-item write for a batch', () => {
    expect(perItemMetaOf(mongodbDescriptor, 'insertOne', callIn('x.y()'), 'write')).toEqual({});
    expect(perItemMetaOf(typeormDescriptor, 'save', callIn('x.y()'), 'write')).toEqual({});
  });

  it('takes a statement with a list in it for a batch, whatever the method', () => {
    expect(perItemMetaOf(undefined, 'query', callIn('x.y()'), 'read', 'SELECT * FROM parcels WHERE id = ANY($1)')).toEqual({ batch: true });
  });
});

describe('a conditional write, by its filter (P89)', () => {
  it('reads a filter naming a state besides the id', () => {
    const call = callIn("db.collection('parcels').findOneAndUpdate({ _id: id, status: 'queued' }, { $set: { status: 'claimed' } })");
    expect(perItemMetaOf(mongodbDescriptor, 'findOneAndUpdate', call, 'write')).toEqual({ conditional: true });
  });

  it('reads TypeORM criteria, a Prisma where and a Sequelize where at their own places', () => {
    expect(perItemMetaOf(typeormDescriptor, 'update', callIn("repo.update({ id, status: 'open' }, { status: 'shut' })"), 'write')).toEqual({ conditional: true });
    expect(perItemMetaOf(prismaDescriptor, 'update', callIn("prisma.parcel.update({ where: { id, status: 'open' }, data: {} })"), 'write')).toEqual({ conditional: true });
    expect(perItemMetaOf(sequelizeDescriptor, 'update', callIn("Parcel.update({ status: 'shut' }, { where: { id, status: 'open' } })"), 'write')).toEqual({ conditional: true });
  });

  it('reads a filter bound to a const', () => {
    const call = callIn("const filter = { _id: id, version: 3 };\ncollection.updateOne(filter, {})");
    expect(perItemMetaOf(mongodbDescriptor, 'updateOne', call, 'write')).toEqual({ conditional: true });
  });

  it('does not take a filter on the id alone, a filter it cannot read, or a read', () => {
    expect(perItemMetaOf(mongodbDescriptor, 'updateOne', callIn('c.updateOne({ _id: id }, {})'), 'write')).toEqual({});
    expect(perItemMetaOf(mongodbDescriptor, 'updateOne', callIn('c.updateOne(filter, {})'), 'write')).toEqual({});
    expect(perItemMetaOf(mongodbDescriptor, 'findOne', callIn("c.findOne({ _id: id, status: 'open' })"), 'read')).toEqual({});
  });

  it('reads a guarded update statement', () => {
    const sql = "UPDATE parcels SET status = 'claimed' WHERE id = $1 AND status = 'queued'";
    expect(perItemMetaOf(undefined, 'query', callIn('x.y()'), 'write', sql)).toEqual({ conditional: true });
  });
});
