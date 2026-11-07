<template>
  <section>
    <button @click="loadOrders">Orders</button>
    <button @click="addInvoice">Add invoice</button>
  </section>
</template>

<script setup lang="ts">
import { api } from '../api/client';
import { billing } from '../api/billing';

const loadOrders = () => api.get('/items');
const addInvoice = () => billing('/items', { method: 'POST', body: { name: 'pen' } });
</script>
