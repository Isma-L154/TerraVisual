import { useState } from 'react';

import { Editor } from './editor/Editor';
import { DiagnosticsList } from './editor/DiagnosticsList';
import { Diagram } from './diagram/Diagram';
import { NodeDetails } from './diagram/NodeDetails';
import { Outline } from './outline/Outline';
import type { Diagnostic, Range } from './model';
import { useAnalysis } from './app/useAnalysis';
import { hasSource, nodeAtLine } from './app/locate';
import { useSession } from './app/useSession';
import { ShareButton } from './app/ShareButton';
import { ImportDropZone } from './workspace/ImportDropZone';
import type { ImportResult } from './workspace/import';

/**
 * The application shell.
 *
 * The editor and the diagnostics are real. The diagram is not built yet (#10)
 * and says so rather than showing an empty frame that looks like a bug.
 */
export function App() {
  const { workspace, origin, loading, storageAvailable, reset } = useSession();
  // The open file is derived rather than stored, and so is its content.
  //
  // Storing them meant an effect that corrected itself whenever the session
  // finished loading — a render pass whose only job was to fix the previous
  // one. Deriving removes the effect and the whole class of bug where the two
  // copies disagree.
  const [chosenPath, setChosenPath] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'diagram' | 'outline'>('diagram');
  const [reveal, setReveal] = useState<Range | null>(null);
  const [importing, setImporting] = useState(false);

  const analysis = useAnalysis(workspace);

  const paths = workspace.list();
  // A file the user chose, while it still exists. After an import or a reset
  // it will not, and falling back to the first file is what somebody expects.
  const activePath = chosenPath && workspace.has(chosenPath) ? chosenPath : (paths[0] ?? '');
  const content = workspace.read(activePath) ?? '';

  // These are plain functions rather than useCallback. Nothing they are passed
  // to is memoized, so a stable identity buys nothing -- and the compiler
  // could not verify the manual memoization anyway, which is a good reason to
  // stop asserting it.
  const handleChange = (next: string) => workspace.write(activePath, next);

  const openFile = (path: string) => setChosenPath(path);

  /**
   * Jump to a place in the code.
   *
   * A fresh object is stored every time, even for the same range, so clicking
   * the same diagnostic twice scrolls back to it rather than doing nothing.
   */
  const revealSource = (source: Range) => {
    if (!source.file || source.startLine < 1) return;
    if (source.file !== activePath && workspace.has(source.file)) {
      setChosenPath(source.file);
    }
    setReveal({ ...source });
  };

  const revealDiagnostic = (diagnostic: Diagnostic) => revealSource(diagnostic.source);

  /**
   * Selecting something in the diagram or the outline, which also reveals the
   * code that declares it.
   *
   * Only an explicit selection jumps. Moving the cursor selects a node too
   * (below), and if that also jumped, the editor would fight the person typing
   * in it.
   */
  const selectNode = (id: string | null) => {
    // Re-selecting what is already selected must not jump again: the cursor
    // may have moved on within the same resource, and yanking it back would
    // fight the person typing.
    if (id === selectedId) return;

    setSelectedId(id);
    if (!id) return;

    const target = analysis.model?.nodes.find((node) => node.id === id);
    if (target && hasSource(target)) revealSource(target.source);
  };

  /**
   * The other direction: the cursor moving highlights the node it is inside.
   *
   * This one deliberately does not scroll the diagram. Somebody typing has
   * their attention in the editor, and a diagram that panned on every
   * keystroke would be a distraction rather than a help.
   */
  const handleCursorLine = (line: number) => {
    const id = nodeAtLine(analysis.model, activePath, line);
    if (id) setSelectedId(id);
  };

  /**
   * Replace the workspace with an imported project.
   *
   * The example is cleared rather than merged: mixing somebody's real
   * infrastructure with a demo would produce a diagram that is neither.
   */
  const handleImported = (result: ImportResult) => {
    if (Object.keys(result.files).length === 0) return;

    workspace.clear();
    for (const [path, fileContent] of Object.entries(result.files)) {
      try {
        workspace.write(path, fileContent);
      } catch {
        // Already reported by the importer, which knows why.
      }
    }

    setChosenPath(null);
    setSelectedId(null);
    setImporting(false);
  };

  const diagnostics = analysis.model?.diagnostics ?? [];
  const selected = analysis.model?.nodes.find((node) => node.id === selectedId) ?? null;

  return (
    <>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>

      <header className="app-header">
        <h1>TerraVisual</h1>
        <p className="tagline">See the infrastructure your Terraform describes, as you write it.</p>
      </header>

      {loading ? (
        <p className="app-loading" role="status">
          Loading your workspace…
        </p>
      ) : null}

      <main id="workspace" className="workspace">
        <section className="pane pane-editor" aria-labelledby="editor-heading">
          <div className="pane-header">
            <h2 id="editor-heading">Code</h2>
            <button
              type="button"
              className="file-tab"
              aria-expanded={importing}
              onClick={() => setImporting((open) => !open)}
            >
              {importing ? 'Close import' : 'Import project'}
            </button>
            <button type="button" className="file-tab" onClick={reset}>
              Reset
            </button>
            {paths.length > 1 ? (
              <nav aria-label="Workspace files" className="file-tabs">
                {paths.map((path) => (
                  <button
                    key={path}
                    type="button"
                    className="file-tab"
                    aria-current={path === activePath ? 'true' : undefined}
                    onClick={() => openFile(path)}
                  >
                    {path}
                  </button>
                ))}
              </nav>
            ) : null}
          </div>

          {importing ? <ImportDropZone onImported={handleImported} /> : null}

          <Editor
            path={activePath}
            content={content}
            diagnostics={diagnostics}
            reveal={reveal}
            onChange={handleChange}
            onCursorLine={handleCursorLine}
          />
        </section>

        <section className="pane" aria-labelledby="diagram-heading">
          <div className="pane-header">
            <h2 id="diagram-heading">Infrastructure</h2>
            <div className="pane-tools">
              {/* Two ways to read the same model, not a picture and a fallback.
                  A spatial canvas is a poor way to read a hierarchy, however
                  accessible its individual nodes are. */}
              <div className="view-switch" role="group" aria-label="How to view the infrastructure">
                <button
                  type="button"
                  className="file-tab"
                  aria-pressed={view === 'diagram'}
                  onClick={() => setView('diagram')}
                >
                  Diagram
                </button>
                <button
                  type="button"
                  className="file-tab"
                  aria-pressed={view === 'outline'}
                  onClick={() => setView('outline')}
                >
                  Outline
                </button>
              </div>
              <AnalysisStatus analyzing={analysis.analyzing} error={analysis.error} />
            </div>
          </div>

          {analysis.model?.stats.truncated ? (
            /* Saying so is not optional: a partial picture presented as a
               complete one is the failure mode this project cares most about. */
            <p className="pane-notice" role="status">
              This workspace is larger than the analyzer will fully expand, so the diagram is
              incomplete. Check the problems below for what was left out.
            </p>
          ) : null}

          {view === 'diagram' ? (
            <Diagram model={analysis.model} selectedId={selectedId} onSelect={selectNode} />
          ) : (
            <Outline model={analysis.model} selectedId={selectedId} onSelect={selectNode} />
          )}
        </section>

        <section className="pane pane-details" aria-labelledby="details-heading">
          <div className="pane-header">
            <h2 id="details-heading">Details</h2>
          </div>
          <NodeDetails node={selected} onReveal={(node) => revealSource(node.source)} />
        </section>

        <section className="pane pane-diagnostics" aria-labelledby="diagnostics-heading">
          <div className="pane-header">
            <h2 id="diagnostics-heading">Problems</h2>
            {analysis.model ? (
              <span className="analysis-status">
                {plural(analysis.model.stats.resources, 'resource')}
                {analysis.model.stats.truncated ? ', partial' : ''}
              </span>
            ) : null}
          </div>
          {analysis.error ? (
            <p className="diagnostic-error" role="alert">
              {analysis.error}
            </p>
          ) : (
            <DiagnosticsList diagnostics={diagnostics} onSelect={revealDiagnostic} />
          )}
        </section>
      </main>

      <footer className="app-footer">
        <ShareButton files={() => workspace.snapshot()} />

        {origin === 'shared' ? (
          <p className="footer-note">
            This workspace came from a shared link. Editing it changes only your copy.
          </p>
        ) : null}
        {origin === 'restored' ? (
          <p className="footer-note">Restored from your last visit.</p>
        ) : null}
        {!storageAvailable ? (
          <p className="footer-note">
            This browser is not letting the page store anything, so your work will not be here next
            time.
          </p>
        ) : null}

        <p>
          Your code never leaves your browser. Parsing, evaluation and rendering all happen on this
          page.
        </p>
      </footer>
    </>
  );
}

/**
 * Whether analysis is running.
 *
 * Announced politely rather than assertively: it changes on every keystroke,
 * and an assertive live region would interrupt a screen reader constantly.
 */
function AnalysisStatus({ analyzing, error }: { analyzing: boolean; error: string | null }) {
  if (error) return null;
  return (
    <span className="analysis-status" role="status" aria-live="polite">
      {analyzing ? 'Analyzing…' : ''}
    </span>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
