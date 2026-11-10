<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function openItem(sku: string) {
  router.push({ name: 'stock-item', params: { sku } });
}
</script>

<template>
  <main>
    <RouterLink to="/stock">Stock</RouterLink>
    <router-link :to="{ name: 'stock' }">Stock by name</router-link>
    <button @click="openItem('A-1')">Open</button>
  </main>
</template>
