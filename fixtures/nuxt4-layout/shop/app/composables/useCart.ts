/** The cart. A default export, which Nuxt imports by its file's name: `useCart`. */
export default function () {
  const add = async (name: string): Promise<void> => {
    await $fetch('/api/cart', { method: 'POST', body: { item: slugify(name) } });
  };
  return { add };
}
