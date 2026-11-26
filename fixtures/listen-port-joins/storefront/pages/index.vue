<template>
  <main>
    <h1>Products</h1>
    <ul>
      <li v-for="product in products" :key="product.id">{{ product.name }}</li>
    </ul>
    <button @click="load">Basket</button>
  </main>
</template>

<script setup lang="ts">
// The catalog is another service: this one call sends itself there, by a hook
// written on the call alone.
const { data: products } = await useFetch('/products', {
  onRequest({ options }) {
    options.baseURL = 'http://localhost:3003';
  },
});

const load = async (): Promise<void> => {
  await $fetch('/api/basket');
};
</script>
