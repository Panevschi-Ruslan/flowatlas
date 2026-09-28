import { describe, expect, it } from 'vitest';
import { prisma } from './db';

// A test that talks to a real database. Its queries set up rows and assert on
// them; none of them is something the service does, so none of them belongs in
// the graph.
const seedOrder = async () => prisma.order.create({ data: { ownerId: 'u1', draft: true } });

describe('orders', () => {
  it('clears drafts', async () => {
    await seedOrder();
    await prisma.order.deleteMany({ where: { draft: true } });
    expect(await prisma.order.count({ where: { draft: true } })).toBe(0);
  });
});
