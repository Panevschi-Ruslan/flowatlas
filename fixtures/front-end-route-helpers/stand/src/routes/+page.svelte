<script lang="ts">
  import { goto } from '$app/navigation';

  let { data } = $props();
</script>

<a href="/orders">Orders</a>
<a href="/orders/{data.latest}">Latest order</a>
<a href="#top">Top</a>
<a href="https://help.example.com/stand">Help</a>
<button on:click={() => goto('/cart')}>Cart</button>
