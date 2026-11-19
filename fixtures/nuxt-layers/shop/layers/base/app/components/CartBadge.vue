<template>
  <span>{{ CART_LIMIT }}</span>
</template>

<script setup lang="ts">
// `~` is the application's code in every layer, and the application has no utils/limits.
import { CART_LIMIT } from '~/utils/limits';
</script>
