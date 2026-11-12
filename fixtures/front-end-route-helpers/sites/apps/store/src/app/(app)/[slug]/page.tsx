/** A page of the store by its slug, the start page among them. */
export default function StorePage({ params }: { params: { slug?: string } }) {
  return <article>{params.slug ?? 'home'}</article>;
}
