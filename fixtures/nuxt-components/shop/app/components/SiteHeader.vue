<template>
  <header>{{ menu }}</header>
</template>

<script setup lang="ts">
const { data: menu } = await useFetch('/api/menu');
</script>
