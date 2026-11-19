export default function TagPage({ params }: { params: { tag: string } }) {
  return <main>{params.tag}</main>;
}
