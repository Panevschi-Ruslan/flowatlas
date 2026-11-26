import { createRouter, createWebHistory } from 'vue-router';

import HomeView from '../views/HomeView.vue';
import StockView from '../views/StockView.vue';

/** The back office's routes, each screen named. */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/stock', name: 'stock', component: StockView },
    { path: '/stock/:sku', name: 'stock-item', component: () => import('../views/StockItem.vue') },
  ],
});

/** Back to the start, from anywhere: the router made here, imported where it is used. */
export function goHome(): void {
  void router.push('/');
}
