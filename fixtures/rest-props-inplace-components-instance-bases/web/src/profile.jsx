import { useEffect } from 'react';
import { ApiClient, catalogClient, ordersClient, stockClient } from './account';

/** Each request on an instance is under that instance's base. */
export function Profile() {
  useEffect(() => {
    catalogClient.get('/profile');
    stockClient.get('/levels');
    ordersClient.get('/recent');
  }, []);
  return <aside />;
}

/** Handed an instance by each caller: the request is each caller's, under the base of what it hands. */
function loadSummary(client) {
  return client.get('/summary');
}

export function CatalogSummary() {
  useEffect(() => {
    loadSummary(catalogClient);
  }, []);
  return <p />;
}

export function StockSummary() {
  useEffect(() => {
    loadSummary(stockClient);
  }, []);
  return <p />;
}

/**
 * Handed an instance nothing here calls it with: which base is its is not
 * read, and said.
 *
 * @param {ApiClient} client
 */
export function loadAny(client) {
  return client.get('/any');
}
