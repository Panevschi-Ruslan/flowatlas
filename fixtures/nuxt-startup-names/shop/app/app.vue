<script setup lang="ts">
// Added when the root component is set up, so in front of every navigation after the first.
addRouteMiddleware('tenant', async () => {
  await $fetch('/api/tenant');
});
// A composable the setup calls, which adds one in front of every page.
useVisitGuard();
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
