import { createTRPCClient, httpBatchLink } from '@trpc/client';

/** The shop's procedures, at the port Next listens on by default. */
const shop = createTRPCClient<any>({ links: [httpBatchLink({ url: 'http://localhost:3000/api/trpc' })] });

/** Served by the shop, which assumes 3000: the link is placed there. */
export const pendingOrders = () => shop.orders.list.query();

/** Served by nobody at 3000: the port places nothing, as before. */
export const weeklyReport = () => shop.reports.weekly.query();

/** The dashboard's own route, on the port its .env gives NUXT_PORT. */
export const dashboardStats = () => fetch('http://localhost:3010/api/stats').then((res) => res.json());

/** The board's route, on the port its example environment file gives PORT. */
export const boardHealth = () => fetch('http://localhost:8002/api/health').then((res) => res.json());

/** 3000 is not the board's: its default moved to the example's port. */
export const strayHealth = () => fetch('http://localhost:3000/api/health').then((res) => res.json());
