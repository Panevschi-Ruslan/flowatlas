<template>
  <strong>{{ total }}</strong>
</template>

<script setup lang="ts">
const { data: total } = await useFetch('/api/orders/total');
</script>
