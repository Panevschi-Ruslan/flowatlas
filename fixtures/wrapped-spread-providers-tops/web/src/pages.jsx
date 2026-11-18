import React, { forwardRef, memo, useEffect } from 'react';
import { catalogApi, stockApi } from './clients';

// Components wrapped in calls, none of them exported: each is read as a
// component, and its props are what each element written with it hands.
const Feed = memo(function Feed({ client }) {
  useEffect(() => {
    client.get('/feed');
  }, [client]);
  return <ul />;
});

const Panel = React.memo((props) => {
  useEffect(() => {
    props.client.get('/panel');
  }, [props.client]);
  return <section />;
});

const Field = forwardRef((props, ref) => {
  useEffect(() => {
    props.client.get('/field');
  }, [props.client]);
  return <input ref={ref} />;
});

const Both = memo(
  forwardRef(({ client }, ref) => {
    useEffect(() => {
      client.get('/both');
    }, [client]);
    return <div ref={ref} />;
  }),
);

// A prop handed through a spread.
function Tile({ client }) {
  useEffect(() => {
    client.get('/tile');
  }, [client]);
  return <article />;
}

/** The rest of its props spread on: what each element written with `Shell` hands. */
function Shell({ title, ...rest }) {
  return (
    <section>
      <h1>{title}</h1>
      <Tile {...rest} />
    </section>
  );
}

/** Its props spread, then `client` written after: the one written wins. */
function Override(props) {
  return <Tile {...props} client={stockApi} />;
}

/** An object written in place, spread. */
function Pinned() {
  return <Tile {...{ client: catalogApi }} />;
}

/** The props of a component nothing renders: what the spread hands is not read, and said. */
function Orphan(props) {
  return <Tile {...props} />;
}

export function CatalogPage() {
  return (
    <main>
      <Feed client={catalogApi} />
      <Panel client={catalogApi} />
      <Field client={catalogApi} />
      <Both client={catalogApi} />
      <Shell title="Catalog" client={catalogApi} />
      <Override client={catalogApi} />
      <Pinned />
    </main>
  );
}

export function StockPage() {
  return (
    <main>
      <Feed client={stockApi} />
      <Panel client={stockApi} />
      <Field client={stockApi} />
      <Both client={stockApi} />
      <Shell title="Stock" client={stockApi} />
    </main>
  );
}
