<template>
  <section>
    <h1>Basket</h1>
    <button @click="addFirst">Add the first order</button>
    <button @click="clearBasket">Clear</button>
    <AddToBasket id="2" />
  </section>
</template>

<script setup lang="ts">
const { items, add } = useBasket();

const addFirst = async (): Promise<void> => {
  await add('1');
};
</script>
