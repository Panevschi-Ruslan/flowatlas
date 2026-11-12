<script setup lang="ts">
// Back to the start once signed in, in place of the login page.
const done = () => navigateTo('/', { replace: true });
</script>

<template>
  <button @click="done">Sign in</button>
</template>
