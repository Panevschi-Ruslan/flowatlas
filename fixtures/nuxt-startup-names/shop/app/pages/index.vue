<script setup lang="ts">
definePageMeta({ middleware: ['tenant', 'late'] });

const arm = () => useLateGuard();
</script>

<template>
  <PromoBanner />
  <UButton @click="arm">Arm</UButton>
  <PrimeDataTable />
  <PrimeButton label="More" />
</template>
