<script setup lang="ts">
definePageMeta({ middleware: ['auth'] });

// By the name Nuxt gives `orders/[id].vue`.
const open = (id: string) => navigateTo({ name: 'orders-id', params: { id } });
// Out of the application, to the payment provider.
const pay = () => navigateTo('https://pay.example.com/checkout', { external: true });
</script>

<template>
  <NuxtLink to="/orders">Orders</NuxtLink>
  <NuxtLink :to="{ name: 'receipt', params: { id: '1' } }">Last receipt</NuxtLink>
  <button @click="open('1')">First order</button>
  <button @click="pay">Pay</button>
</template>
