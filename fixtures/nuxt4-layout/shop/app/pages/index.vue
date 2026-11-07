<template>
  <main>
    <h1>{{ formatPrice(total) }}</h1>
    <input v-model="query" />
    <button @click="search">Search</button>
    <button @click="reload">Reload</button>
    <button @click="addSelected">Add to cart</button>
  </main>
</template>

<script setup lang="ts">
import { listProducts } from '#catalog/products';

const query = ref('');
const total = ref(0);
const { add } = useCart();

const search = async (): Promise<void> => {
  await searchProducts(query.value);
};

const reload = async (): Promise<void> => {
  await listProducts();
};

const addSelected = async (): Promise<void> => {
  await add(query.value);
  total.value = Number(formatPrice(total.value));
};
</script>
