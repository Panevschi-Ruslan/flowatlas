<template>
  <section>
    <slot />
  </section>
</template>

<script setup lang="ts">
const { data: alerts } = await useFetch('/api/alerts');
</script>
