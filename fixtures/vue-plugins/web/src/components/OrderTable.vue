<template>
  <table />
</template>

<script setup lang="ts">
const orders = fetch('/api/orders').then((response) => response.json());
</script>
