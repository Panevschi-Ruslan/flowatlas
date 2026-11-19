<template>
  <main>
    <h1>{{ heading() }}</h1>
    <button @click="loadOrders">Orders</button>
    <button @click="recordVisit">Visit</button>
  </main>
</template>

<script setup lang="ts">
const { record } = useAudit();

const heading = (): string => slugify('Orders');

const loadOrders = async (): Promise<void> => {
  await $fetch('/api/orders');
};

const recordVisit = async (): Promise<void> => {
  await record('visit');
};
</script>
