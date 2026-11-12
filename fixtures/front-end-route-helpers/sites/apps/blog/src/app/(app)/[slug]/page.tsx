/** A page of the blog by its slug, the start page among them. */
export default function BlogPage({ params }: { params: { slug?: string } }) {
  return <article>{params.slug ?? 'home'}</article>;
}
