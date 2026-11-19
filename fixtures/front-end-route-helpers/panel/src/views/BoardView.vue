<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <main>
    <button @click="router.push('/tickets')">Tickets</button>
    <button @click="$router.replace({ name: 'board' })">Reload</button>
    <button @click="router.back()">Back</button>
  </main>
</template>
