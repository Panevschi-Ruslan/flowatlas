import React, { memo, useEffect } from 'react';
import { catalogApi, stockApi } from './clients';

/** A wrapper of the repository's own taking its options first, then the component. */
function withOptions(options, Component) {
  Component.displayName = options.name;
  return Component;
}

// Components written in place in a call they are not the first argument of.
const Board = withOptions({ name: 'board' }, function Board({ client }) {
  useEffect(() => {
    client.get('/board');
  }, [client]);
  return <div />;
});

const Chart = withOptions(
  { name: 'chart' },
  memo((props) => {
    useEffect(() => {
      props.client.get('/chart');
    }, [props.client]);
    return <canvas />;
  }),
);

/** A comparator beside the component is no component. */
const Row = memo(
  ({ client }) => {
    useEffect(() => {
      client.get('/row');
    }, [client]);
    return <tr />;
  },
  (before, after) => before.client === after.client,
);

/** Takes `client` itself; the rest of its props is what is left. */
function Frame({ client, title, ...rest }) {
  useEffect(() => {
    client.get('/frame');
  }, [client]);
  return (
    <section>
      <h1>{title}</h1>
      <Badge {...rest} />
    </section>
  );
}

/** Handed `client` by name on one page; the rest of `Frame`'s props surely lacks it. */
function Badge({ client, label }) {
  useEffect(() => {
    if (client) client.get('/badge');
  }, [client]);
  return <span>{label}</span>;
}

export function CatalogPage() {
  return (
    <main>
      <Board client={catalogApi} />
      <Chart client={catalogApi} />
      <Row client={catalogApi} />
      <Frame title="Catalog" label="new" client={catalogApi} />
    </main>
  );
}

export function StockPage() {
  return (
    <main>
      <Board client={stockApi} />
      <Chart client={stockApi} />
      <Badge client={stockApi} label="low" />
    </main>
  );
}
