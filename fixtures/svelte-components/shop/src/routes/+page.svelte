<script lang="ts">
  import OrderRow from '$lib/OrderRow.svelte';
  import { place as placeOrder } from '$lib/orders';

  let name = '';
  const place = async (): Promise<void> => {
    await placeOrder(name);
  };
</script>

<h1>Orders</h1>
<input bind:value={name} />
<button on:click={place}>Place</button>
<ul>
  <OrderRow id="1" name="first" />
</ul>
