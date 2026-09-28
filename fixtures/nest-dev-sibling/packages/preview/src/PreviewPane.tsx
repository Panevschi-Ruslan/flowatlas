import { useState } from 'react';

/**
 * A screen in a development tool, two packages away from the API and reachable
 * from it only through a devDependency. None of this belongs in the API's
 * graph: not the component, not the button, not the request.
 */
export function PreviewPane() {
  const [html, setHtml] = useState('');
  const load = async () => {
    const answer = await fetch('/preview/receipt');
    setHtml(await answer.text());
  };
  return (
    <section>
      <button type="button" onClick={() => load()}>
        Render
      </button>
      <iframe title="preview" srcDoc={html} />
    </section>
  );
}
