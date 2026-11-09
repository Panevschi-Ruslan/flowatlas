<script setup lang="ts">
// Added once the root component is mounted, on the client: in front of every navigation after the first.
onMounted(() => {
  addRouteMiddleware(async () => {
    await $fetch('/api/seen', { method: 'POST' });
  });
});
</script>

<template>
  <NuxtPage />
</template>
