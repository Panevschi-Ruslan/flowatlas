<script lang="ts">
  import { goto } from '$app/navigation';

  function start() {
    goto('/menu', { replaceState: true });
  }
</script>

<button onclick={start}>Start</button>
