<template>
  <article>
    <h2>{{ data?.name }}</h2>
    <button @click="orders.remove(id)">Remove</button>
  </article>
</template>

<script setup lang="ts">
import { useOrdersStore } from '~/stores/orders';

const route = useRoute();
const id = String(route.params.id);
const orders = useOrdersStore();
const { data } = await useFetch(`/api/orders/${id}`);
</script>
