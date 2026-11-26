import { GraphBuilder, noAdapters, parseConfig, silentLogger, type ExtractContext, type RepoGraph } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractReact } from '../extract-repo.js';

/** Reads a React repository written in memory. */
const read = (files: Record<string, string>): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false, jsx: 4 } });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const builder = new GraphBuilder({ repo: 'web' });
  const ctx: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '/', type: 'react' },
    config: parseConfig({}),
    pkg: { dependencies: { react: '^19.0.0' } },
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters: noAdapters,
    logger: silentLogger,
  };
  extractReact(ctx, { noTypes: true });
  return builder.build();
};

const rendered = (graph: RepoGraph): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && edge.meta?.['renders'] !== undefined)
    .map((edge) => `${edge.from.split('#')[1]} -> ${edge.to.split('#')[1]}`)
    .sort();

describe('the child components JSX renders (P255)', () => {
  const graph = read({
    'src/Badge.tsx': "export const Badge = () => { fetch('/api/badge'); return <span />; };",
    'src/Row.tsx': 'function RowInner() { return <li />; }\nexport const Row = memo(RowInner);',
    'src/Report.tsx': 'export default function Report() { return <section />; }',
    'src/Page.tsx': [
      "import { Badge } from './Badge';",
      "import { Row } from './Row';",
      "const Report = lazy(() => import('./Report'));",
      'export const Page = () => (',
      '  <main>',
      '    <Badge />',
      '    <Row />',
      '    <Report />',
      '    <Missing />',
      '    <div />',
      '  </main>',
      ');',
    ].join('\n'),
    'src/App.tsx': [
      "import { Page } from './Page';",
      "import { Badge } from './Badge';",
      'export const App = () => <Routes><Route path="/" element={<Page />} /><Badge /></Routes>;',
    ].join('\n'),
  });

  it('draws a component to each component of the repository its markup names, through `memo` and `lazy`', () => {
    expect(rendered(graph)).toEqual([
      'src/App.tsx:App -> src/Badge.tsx:Badge',
      'src/Page.tsx:Page -> src/Badge.tsx:Badge',
      'src/Page.tsx:Page -> src/Report.tsx:Report',
      'src/Page.tsx:Page -> src/Row.tsx:RowInner',
    ]);
  });

  it('leaves a screen a router shows to the router, and says a tag that names nothing', () => {
    expect(rendered(graph).some((edge) => edge.endsWith('src/Page.tsx:Page'))).toBe(false);
    // One row, folded over every tag that names nothing: the router's own, which nothing installed declares, and `<Missing>`.
    const [row] = graph.unresolved.filter((each) => each.reason === 'component-unresolved');
    const samples = (row?.meta?.['causes'] as Array<{ samples: Array<{ symbol?: string }> }>).flatMap((part) => part.samples.map((sample) => sample.symbol));
    expect(samples.sort()).toEqual(['App <Route>', 'App <Routes>', 'Page <Missing>']);
  });
});
