import { TagLink } from './TagLink';

/** The tags of a post, handed in. */
export default function Tags({ tags }: { tags: Array<{ slug: string }> }) {
  return (
    <ul>
      {tags.map((tag) => (
        <li key={tag.slug}>
          <TagLink name={tag.slug} />
        </li>
      ))}
    </ul>
  );
}
