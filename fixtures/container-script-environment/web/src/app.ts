// Requests on this machine, and on the cluster's network.

export const orders = () => fetch('http://localhost:8201/orders');
export const invoices = () => fetch('http://localhost:8202/invoices');
export const products = () => fetch('http://localhost:8203/products');
export const levels = () => fetch('http://localhost:4700/levels');
export const entries = () => fetch('http://localhost:4710/entries');
export const carts = () => fetch('http://localhost:4800/carts');
export const runs = () => fetch('http://localhost:4810/runs');
export const balances = () => fetch('http://accounts/balances');
