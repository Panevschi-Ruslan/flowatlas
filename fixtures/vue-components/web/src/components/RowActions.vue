<template>
  <button @click="cancel">Cancel</button>
</template>

<script setup lang="ts">
const props = defineProps<{ id: string }>();

const cancel = async (): Promise<void> => {
  await fetch(`/api/orders/${props.id}/cancel`, { method: 'POST' });
};
</script>
