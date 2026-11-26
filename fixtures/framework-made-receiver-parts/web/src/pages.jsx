import { Component, useEffect } from 'react';
import { catalogApi, stockApi } from './clients';

// A component handed its client as a prop, taken apart where it is declared.
function Feed({ client }) {
  useEffect(() => {
    client.get('/feed');
  }, [client]);
  return null;
}

// The same, read off the props.
const Panel = (props) => {
  useEffect(() => {
    props.client.get('/panel');
  }, [props.client]);
  return null;
};

// A class component: React makes the instance from each element and calls componentDidMount on it.
class Lister extends Component {
  componentDidMount() {
    return this.props.client.get('/list');
  }

  render() {
    return null;
  }
}

export function CatalogPage() {
  return (
    <main>
      <Feed client={catalogApi} />
      <Panel client={catalogApi} />
      <Lister client={catalogApi} />
    </main>
  );
}

export function StockPage() {
  return (
    <main>
      <Feed client={stockApi} />
      <Panel client={stockApi} />
      <Lister client={stockApi} />
    </main>
  );
}
