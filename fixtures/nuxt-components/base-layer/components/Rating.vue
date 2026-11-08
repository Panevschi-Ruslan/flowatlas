<template>
  <span @click="rate">Rate</span>
</template>

<script setup lang="ts">
const rate = async (): Promise<void> => {
  await $fetch('/api/ratings', { method: 'POST' });
};
</script>
