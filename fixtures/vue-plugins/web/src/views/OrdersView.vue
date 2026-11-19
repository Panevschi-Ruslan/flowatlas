<template>
  <VCard>
    <OrderTable />
  </VCard>
  <OrderChart />
  <AppBadge />
  <Button label="Refresh" />
  <DataTable />
  <KitPanel />
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const OrderTable = defineAsyncComponent(() => import('../components/OrderTable.vue'));
</script>
