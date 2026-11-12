<template>
  <main>
    <h1>{{ BRAND_NAME }}</h1>
    <button @click="refreshBrand">Refresh</button>
  </main>
</template>

<script setup lang="ts">
// The application's own home page: the one at `/` in `../ui-layer` is not shown.
import { BRAND_NAME } from '#brand/name';

const { refresh } = useBrand();

const refreshBrand = async (): Promise<void> => {
  await refresh();
};
</script>
