import { describe, expect, it } from 'vitest';
import { wizardChain, type StepSite } from './scenes.js';

const site = (index: number, line: number): StepSite => ({
  index,
  id: `entry:bot:scene_step:register#${index}`,
  file: 'src/register.wizard.ts',
  line,
  symbol: `RegisterWizard.step${index}`,
});

describe('ordering the steps of a wizard', () => {
  it('links each step to the next one that exists, gaps and all', () => {
    const chain = wizardChain([site(1, 4), site(4, 12), site(2, 8)]);
    expect(chain.steps.map((step) => step.index)).toEqual([1, 2, 4]);
    expect(chain.edges).toEqual([
      { from: site(1, 4).id, to: site(2, 8).id, order: 1, line: 4 },
      { from: site(2, 8).id, to: site(4, 12).id, order: 2, line: 8 },
    ]);
  });

  it('numbers each link after the step it leaves', () => {
    expect(wizardChain([site(3, 4), site(7, 8)]).edges.map((link) => link.order)).toEqual([3]);
  });

  it('keeps the first of two steps claiming the same number and reports the other', () => {
    const first = site(2, 8);
    const second = { ...site(2, 20), symbol: 'RegisterWizard.alsoTwo' };
    const chain = wizardChain([first, second, site(3, 30)]);
    expect(chain.steps).toEqual([first, site(3, 30)]);
    expect(chain.conflicts).toEqual([second]);
    expect(chain.edges).toEqual([{ from: first.id, to: site(3, 30).id, order: 2, line: 8 }]);
  });

  it('draws nothing for a wizard with one step', () => {
    const chain = wizardChain([site(1, 4)]);
    expect(chain.edges).toEqual([]);
    expect(chain.conflicts).toEqual([]);
  });
});
