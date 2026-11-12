<script lang="ts">
export default {
  methods: {
    open(sku: string) {
      this.$router.push(`/stock/${sku}`);
    },
    close() {
      this.$router.replace({ name: 'missing-screen' });
    },
  },
};
</script>

<template>
  <section>
    <button @click="open('B-2')">Open</button>
    <button @click="close()">Close</button>
  </section>
</template>
