<template>
  <section>
    <h1>Orders</h1>
    <button @click="refresh">Refresh</button>
    <input v-model="name" @input="typed = true" />
    <button @click="orders.add(name)">Add</button>
    <button @click="archive">Archive</button>
    <ul>
      <li v-for="order in list" :key="order.id">{{ order.name }}</li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { useOrders } from '../composables/useOrders';
import { useOrdersStore } from '../stores/orders';

const name = ref('');
const typed = ref(false);
const orders = useOrdersStore();
const { orders: list, load } = useOrders();

const refresh = async (): Promise<void> => {
  await load();
};

onMounted(() => load());
</script>
