import { useState } from 'react';

import { Editor } from './editor/Editor';
import { DiagnosticsList } from './editor/DiagnosticsList';
import { Diagram } from './diagram/Diagram';
import { NodeDetails } from './diagram/NodeDetails';
import { Outline } from './outline/Outline';
import { Footer } from './app/Footer';
import { useAnalysis } from './app/useAnalysis';
import { useSession } from './app/useSession';
import { useSourceNavigation } from './app/useSourceNavigation';
import { ImportDropZone } from './workspace/ImportDropZone';
import type { ImportResult } from './workspace/import';

/** The page: the code, the infrastructure it describes, details, and problems. */
export function App() {
  const session = useSession();
  const { workspace } = session;
  const analysis = useAnalysis(workspace);
  const navigation = useSourceNavigation(workspace, analysis.model);

  const [view, setView] = useState<'diagram' | 'outline'>('diagram');
  const [importing, setImporting] = useState(false);
  const [hiddenInDiagram, setHiddenInDiagram] = useState(0);

  const { paths, activePath } = navigation;
  const diagnostics = analysis.model?.diagnostics ?? [];

  // An import replaces the example rather than merging into it.
  const handleImported = (result: ImportResult) => {
    if (Object.keys(result.files).length === 0) return;
    session.replace(result.files);
    navigation.forget();
    setImporting(false);
  };

  return (
    <>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>

      <header className="app-header">
        <h1>TerraVisual</h1>
        <p className="tagline">See the infrastructure your Terraform describes, as you write it.</p>
      </header>

      {session.loading ? (
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
            <button type="button" className="file-tab" onClick={session.reset}>
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
                    onClick={() => navigation.openFile(path)}
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
            content={workspace.read(activePath) ?? ''}
            diagnostics={diagnostics}
            reveal={navigation.reveal}
            onChange={(next) => workspace.write(activePath, next)}
            onCursorLine={navigation.followCursor}
          />
        </section>

        <section className="pane" aria-labelledby="diagram-heading">
          <div className="pane-header">
            <h2 id="diagram-heading">Infrastructure</h2>
            <div className="pane-tools">
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

          {hiddenInDiagram > 0 && view === 'diagram' ? (
            <p className="pane-notice" role="status">
              This workspace is large, so the diagram summarises: {hiddenInDiagram} resources are
              folded into their containers. Open one with the button on it, or use the outline,
              which lists everything.
            </p>
          ) : null}

          {analysis.model?.stats.truncated ? (
            <p className="pane-notice" role="status">
              This workspace is larger than the analyzer will fully expand, so the diagram is
              incomplete. Check the problems below for what was left out.
            </p>
          ) : null}

          {view === 'diagram' ? (
            <Diagram
              model={analysis.model}
              selectedId={navigation.selectedId}
              onSelect={navigation.selectNode}
              onSummarised={setHiddenInDiagram}
            />
          ) : (
            <Outline
              model={analysis.model}
              selectedId={navigation.selectedId}
              onSelect={navigation.selectNode}
            />
          )}
        </section>

        <section className="pane pane-details" aria-labelledby="details-heading">
          <div className="pane-header">
            <h2 id="details-heading">Details</h2>
          </div>
          <NodeDetails
            node={navigation.selected}
            onReveal={(node) => navigation.revealSource(node.source)}
          />
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
            <DiagnosticsList
              diagnostics={diagnostics}
              onSelect={(diagnostic) => navigation.revealSource(diagnostic.source)}
            />
          )}
        </section>
      </main>

      <Footer
        origin={session.origin}
        storageAvailable={session.storageAvailable}
        files={() => workspace.snapshot()}
      />
    </>
  );
}

/** Polite rather than assertive: it changes on every keystroke. */
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
