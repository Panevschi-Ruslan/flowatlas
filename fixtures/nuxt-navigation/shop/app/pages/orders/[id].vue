<script setup lang="ts">
const route = useRoute();
</script>

<template>
  <h1>Order {{ route.params.id }}</h1>
  <NuxtLink to="/orders">All orders</NuxtLink>
</template>
