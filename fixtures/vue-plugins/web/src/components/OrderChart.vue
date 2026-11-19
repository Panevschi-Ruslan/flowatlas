<template>
  <figure>
    <ChartLegend />
  </figure>
</template>

<script lang="ts">
import { defineAsyncComponent, defineComponent } from 'vue';

export default defineComponent({
  components: {
    ChartLegend: defineAsyncComponent({ loader: () => import('./ChartLegend.vue') }),
  },
  setup() {
    const stats = fetch('/api/orders/stats');
    return { stats };
  },
});
</script>
