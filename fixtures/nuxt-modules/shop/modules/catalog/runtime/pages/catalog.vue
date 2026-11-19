<template>
  <main>
    <h1>{{ title }}</h1>
    <button @click="refresh">Refresh</button>
  </main>
</template>

<script setup lang="ts">
import { catalogTitle } from '#catalog/title';

const { load } = useCatalog();
const title = catalogTitle();

const refresh = async (): Promise<void> => {
  await load();
};
</script>
