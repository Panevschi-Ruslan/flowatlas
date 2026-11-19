<template>
  <span @click="open">Cart</span>
</template>

<script setup lang="ts">
const open = async (): Promise<void> => {
  await $fetch('/api/cart');
};
</script>
