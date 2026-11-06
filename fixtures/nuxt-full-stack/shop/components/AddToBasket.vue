<template>
  <button @click="addThis">Add to basket</button>
</template>

<script setup lang="ts">
import { useBasket } from '#imports';

const props = defineProps<{ id: string }>();
const { add } = useBasket();

const addThis = async (): Promise<void> => {
  await add(props.id);
};
</script>
