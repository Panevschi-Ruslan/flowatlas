<template>
  <h1>Admin</h1>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['auth', 'catalog-guard', 'audit'],
});
</script>
