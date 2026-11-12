<template>
  <article>
    <h2>{{ order?.name }}</h2>
    <button v-on:click.prevent="cancel">Cancel the order</button>
  </article>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

import { api } from '../api/client';

export default defineComponent({
  data: () => ({ order: null as null | { id: string; name: string } }),
  methods: {
    async cancel(): Promise<void> {
      if (this.order === null) return;
      await api.post(`/orders/${this.order.id}/cancel`);
    },
  },
});
</script>
