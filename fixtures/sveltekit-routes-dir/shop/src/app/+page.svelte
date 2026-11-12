<script lang="ts">
  import { listItems } from '$lib/api';

  const refresh = async (): Promise<void> => {
    await listItems();
  };
</script>

<h1>Items</h1>
<button onclick={refresh}>Refresh</button>
