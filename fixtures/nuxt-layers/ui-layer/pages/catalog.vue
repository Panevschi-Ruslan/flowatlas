<template>
  <main>
    <p>{{ price() }}</p>
    <button @click="loadAll">Load</button>
    <button @click="applyTheme">Theme</button>
  </main>
</template>

<script setup lang="ts">
const { load } = useCatalog();
const theme = useTheme();

const price = (): string => formatPrice(0);

const loadAll = async (): Promise<void> => {
  await load();
};

const applyTheme = async (): Promise<void> => {
  await theme.load();
};
</script>
