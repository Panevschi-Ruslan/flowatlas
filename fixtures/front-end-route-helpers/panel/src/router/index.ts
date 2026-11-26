import { createRouter, createWebHistory } from 'vue-router';

import BoardView from '../views/BoardView.vue';
import TicketsView from '../views/TicketsView.vue';

/** The panel's routes. */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'board', component: BoardView },
    { path: '/tickets', name: 'tickets', component: TicketsView },
  ],
});
