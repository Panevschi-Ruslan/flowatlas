<template>
  <article>
    <h2>{{ data?.name }}</h2>
    <button @click="orders.remove(id)">Remove</button>
    <button @click="renameIt">Rename</button>
  </article>
</template>

<script setup lang="ts">
import { useOrdersStore } from '~/stores/orders';
import { useOrderApi } from '~/composables/useOrderApi';

const route = useRoute();
const id = String(route.params.id);
const orders = useOrdersStore();
const { rename } = useOrderApi();
const { data } = await useFetch(`/api/orders/${id}`);

const renameIt = async (): Promise<void> => {
  await rename(id, 'renamed');
};
</script>
