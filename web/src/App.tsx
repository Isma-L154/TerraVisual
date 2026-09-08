/**
 * The application shell.
 *
 * This is scaffolding (issue #3). The panes are placeholders and say so —
 * a shell that looks finished but does nothing is the kind of thing that
 * quietly becomes the product. The editor arrives in #6, the diagram in #10,
 * and the accessible tree in #11.
 *
 * The structure is deliberate even at this stage: landmark regions, a skip
 * link and headings, because retrofitting semantics onto a finished layout is
 * far harder than starting with them (NFR-6).
 */
export function App() {
  return (
    <>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>

      <header className="app-header">
        <h1>TerraVisual</h1>
        <p className="tagline">See the infrastructure your Terraform describes, as you write it.</p>
      </header>

      <main id="workspace" className="workspace">
        <section className="pane" aria-labelledby="editor-heading">
          <h2 id="editor-heading">Code</h2>
          <p className="placeholder">The editor is not built yet.</p>
        </section>

        <section className="pane" aria-labelledby="diagram-heading">
          <h2 id="diagram-heading">Infrastructure</h2>
          <p className="placeholder">The diagram is not built yet.</p>
        </section>
      </main>

      <footer className="app-footer">
        <p>
          Your code never leaves your browser. Parsing, evaluation and rendering all happen on this
          page.
        </p>
      </footer>
    </>
  );
}
