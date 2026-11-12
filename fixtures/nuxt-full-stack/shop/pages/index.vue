<template>
  <main>
    <h1>Orders</h1>
    <input v-model="name" />
    <button @click="create">Create</button>
    <ul>
      <li v-for="order in data" :key="order.id">{{ order.name }}</li>
    </ul>
  </main>
</template>

<script setup lang="ts">
const name = ref('');
const { data, refresh } = await useFetch('/api/orders');

const create = async (): Promise<void> => {
  await $fetch('/api/orders', { method: 'POST', body: { name: name.value } });
  await refresh();
};
</script>
