<template>
  <main>
    <CartBadge />
    <LazyProductList />
    <UiButton label="Buy" />
    <order-total />
    <base-card />
    <Rating />
    <Map />
    <SearchBox />
    <NuxtImg src="/logo.png" />
    <NuxtLink to="/admin">Admin</NuxtLink>
    <ClientOnly>
      <Mystery />
    </ClientOnly>
    <cookie-banner />
  </main>
</template>
