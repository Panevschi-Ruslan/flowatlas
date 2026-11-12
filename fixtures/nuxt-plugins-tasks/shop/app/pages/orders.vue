<template>
  <ElTable :data="orders" />
  <ElButton>Refresh</ElButton>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['signed-in', 'reports-only'] });

const { data: orders } = await useFetch('/api/orders');
</script>
