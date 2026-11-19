<script lang="ts">
  import * as orders from './orders';

  let { id, name }: { id: string; name: string } = $props();
  let cancelled = $state(false);
</script>

<li>
  {name}
  {#if !cancelled}
    <button onclick={() => orders.cancel(id)}>Cancel</button>
  {/if}
</li>
