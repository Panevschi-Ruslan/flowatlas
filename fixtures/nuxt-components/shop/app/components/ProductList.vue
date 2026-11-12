<template>
  <ul>
    <li v-for="product in products" :key="product.id">{{ product.name }}</li>
  </ul>
</template>

<script setup lang="ts">
const { data: products } = await useFetch('/api/products');
</script>
