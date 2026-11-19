<template>
  <main>
    <p>{{ shown() }} of at most {{ CART_LIMIT }}</p>
    <button @click="addOne">Add</button>
  </main>
</template>

<script setup lang="ts">
// A directory of `layers/` by its name.
import { CART_LIMIT } from '#layers/base/app/utils/limits';

const total = ref(0);
const { add } = useCart();

const shown = (): string => formatMoney(total.value);

const addOne = async (): Promise<void> => {
  await add('tea');
  total.value += 1;
};
</script>
