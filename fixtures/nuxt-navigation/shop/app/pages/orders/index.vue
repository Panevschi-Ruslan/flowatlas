<script setup lang="ts">
const { data } = await useFetch('/api/orders');
// A path written as a template: the page whose address has a parameter there.
const show = (id: string) => navigateTo(`/orders/${id}`);
// No page shows this address.
const lost = () => navigateTo('/archive');
// Written as code: which page is not read.
const go = (to: string) => navigateTo(to);
</script>

<template>
  <ul>
    <li v-for="order in data" :key="order.id" @click="show(order.id)">{{ order.id }}</li>
  </ul>
  <button @click="lost">Archive</button>
  <button @click="go('/')">Home</button>
  <!-- Back to the start page, which links here: two pages linking to each other are no cycle. -->
  <NuxtLink to="/">Start</NuxtLink>
</template>
