<template>
  <button @click="search">Search</button>
</template>

<script setup lang="ts">
const search = async (): Promise<void> => {
  await $fetch('/api/search');
};
</script>
