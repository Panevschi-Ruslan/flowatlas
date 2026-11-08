<template>
  <main>
    <h1>Products</h1>
    <button @click="load">Orders</button>
  </main>
</template>

<script setup lang="ts">
const { data: products } = await useFetch('/catalog/products');

const load = async (): Promise<void> => {
  await $fetch('/orders-api/orders');
};
</script>
