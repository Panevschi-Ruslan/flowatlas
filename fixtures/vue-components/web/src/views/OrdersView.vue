<template>
  <section>
    <AppIcon />
    <order-row v-for="id in ids" :id="id" :key="id" />
    <cart-summary />
    <component :is="OrderRow" id="first" />
    <ShippingNote />
    <date-picker-element />
  </section>
</template>

<script setup lang="ts">
import OrderRow from '../components/OrderRow.vue';

const ids = ['1', '2'];
</script>
