<template>
  <li>
    {{ id }}
    <RowActions :id="id" />
  </li>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

import RowActions from './RowActions.vue';

export default defineComponent({
  components: { RowActions },
  props: { id: { type: String, required: true } },
});
</script>
