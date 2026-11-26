/** The shop, on the port of the file Bun loads for the production its script sets. */
export const products = () => fetch('http://localhost:4102/api/products').then((res) => res.json());

/** The admin, on the port of the only file its script's --env-file names. */
export const reports = () => fetch('http://localhost:4202/api/reports').then((res) => res.json());
