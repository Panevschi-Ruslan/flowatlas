import { createRouter, createWebHistory } from 'vue-router';

import OrdersView from '@/views/OrdersView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/orders',
      component: OrdersView,
      children: [{ path: ':id', component: () => import('../views/OrderDetail.vue') }],
    },
  ],
});
