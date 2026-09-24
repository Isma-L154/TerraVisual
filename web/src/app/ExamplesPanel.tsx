import { EXAMPLES, type Example } from './examples';

type ExamplesPanelProps = {
  onOpen: (example: Example) => void;
};

/** Ready-made workspaces, each teaching one idea. */
export function ExamplesPanel({ onOpen }: ExamplesPanelProps) {
  return (
    <section className="examples" aria-labelledby="examples-heading" data-testid="examples">
      <h2 id="examples-heading" className="visually-hidden">
        Examples
      </h2>
      <ul className="examples-list">
        {EXAMPLES.map((example) => (
          <li key={example.id}>
            <button type="button" className="example" onClick={() => onOpen(example)}>
              <span className="example-title">{example.title}</span>
              <span className="example-summary">{example.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
