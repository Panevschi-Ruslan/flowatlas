// Requests on this machine, and on the cluster's network.

export const items = () => fetch('http://localhost:4050/items');
export const itemsNowhere = () => fetch('http://localhost:4050/nowhere');
export const things = () => fetch('http://localhost:4100/things');
export const auditLog = () => fetch('http://localhost:4100/audit/log');
export const stuff = () => fetch('http://localhost:4200/stuff');
export const orders = () => fetch('http://localhost:8080/orders');
export const levels = () => fetch('http://localhost:8081/levels');
export const invoices = () => fetch('http://localhost:8090/invoices');
export const inventory = () => fetch('http://inventory/items');
export const entries = () => fetch('http://ledger/entries');
