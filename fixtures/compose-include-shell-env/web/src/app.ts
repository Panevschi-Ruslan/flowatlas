// Requests on this machine, and on the cluster's network.

export const orders = () => fetch('http://localhost:8101/orders');
export const invoices = () => fetch('http://localhost:8102/invoices');
export const products = () => fetch('http://localhost:8103/products');
export const levels = () => fetch('http://localhost:4600/levels');
export const entries = () => fetch('http://ledger/entries');
export const log = () => fetch('http://audit/log');
