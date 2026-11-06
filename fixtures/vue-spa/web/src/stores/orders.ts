import { defineStore } from 'pinia';

import { api } from '#api/client';

export const useOrdersStore = defineStore('orders', {
  state: () => ({ added: 0 }),
  actions: {
    async add(name: string): Promise<void> {
      await api.post('/orders', { name });
      this.added += 1;
    },
  },
});
