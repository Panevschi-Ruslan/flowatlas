<script setup lang="ts">
// Added each time the banner is shown: which navigations it stands in front of depends on where it is.
addRouteMiddleware('promo-seen', () => undefined);
</script>

<template>
  <UAlert title="Free delivery" />
</template>
