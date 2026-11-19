<script lang="ts">
  import { signOut } from '$lib/api';

  let { children } = $props();
</script>

<header><button onclick={signOut}>Sign out</button></header>
{@render children()}
