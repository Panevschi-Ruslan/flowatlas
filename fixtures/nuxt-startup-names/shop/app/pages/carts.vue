<script setup lang="ts">
const prune = () => $fetch('/api/carts/prune', { method: 'POST' });
</script>

<template>
  <UCard>
    <UButton @click="prune">Prune now</UButton>
  </UCard>
  <!-- PrimeVue's own name, without the prefix the application sets: no component registers it. -->
  <Button label="Back" />
</template>
