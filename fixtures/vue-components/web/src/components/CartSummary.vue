<template>
  <aside>{{ count }}</aside>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

const count = ref(0);
onMounted(async () => {
  const response = await fetch('/api/cart');
  count.value = (await response.json()).count;
});
</script>
