<script lang="ts">
  import { goto } from '$app/navigation';
  import OrderRow from '$lib/OrderRow.svelte';
  import { listOrders } from '$lib/api';
  import { place as placeOrder } from '$orders';

  let name = '';
  const place = async (): Promise<void> => {
    await placeOrder(name);
    await goto('/');
  };
  const refresh = async (): Promise<void> => {
    await listOrders();
  };
</script>

<h1>Orders</h1>
<input bind:value={name} />
<button on:click={place}>Place</button>
<button on:click={refresh}>Refresh</button>
<ul>
  <OrderRow id="1" name="first" />
</ul>
