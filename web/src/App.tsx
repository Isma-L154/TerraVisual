import { useState, type CSSProperties } from 'react';

import { Editor } from './editor/Editor';
import { DiagnosticsList } from './editor/DiagnosticsList';
import { Diagram } from './diagram/Diagram';
import { NodeDetails } from './diagram/NodeDetails';
import { Outline } from './outline/Outline';
import { Footer } from './app/Footer';
import { ShareButton } from './app/ShareButton';
import { ExamplesPanel } from './app/ExamplesPanel';
import { Splitter } from './app/Splitter';
import { SPLIT } from './app/split';
import { useAnalysis } from './app/useAnalysis';
import { useSession } from './app/useSession';
import { useSourceNavigation } from './app/useSourceNavigation';
import { ImportPanel } from './workspace/ImportPanel';
import { ImportReport } from './workspace/ImportReport';
import { FileBar } from './workspace/FileBar';
import { checkNewPath } from './workspace/newPath';
import { entriesFromDrop } from './workspace/import';
import { useFileDrop } from './workspace/useFileDrop';
import { useImport } from './workspace/useImport';

/** The page: the code, the infrastructure it describes, details, and problems. */
export function App() {
  const session = useSession();
  const { workspace } = session;
  const analysis = useAnalysis(workspace);
  const navigation = useSourceNavigation(workspace, analysis.model);

  const [view, setView] = useState<'diagram' | 'outline'>('diagram');
  const [split, setSplit] = useState<number>(SPLIT.initial);
  // One panel under the header at a time.
  const [panel, setPanel] = useState<'import' | 'examples' | null>(null);
  const toggle = (next: 'import' | 'examples') => setPanel((open) => (open === next ? null : next));
  const [hiddenInDiagram, setHiddenInDiagram] = useState(0);

  const { paths, activePath } = navigation;
  const diagnostics = analysis.model?.diagnostics ?? [];

  // An import replaces the workspace rather than merging into it.
  const importer = useImport((files) => {
    session.replace(files, 'imported');
    navigation.forget();
    setPanel(null);
  });
  const dropping = useFileDrop((transfer) => void importer.run(() => entriesFromDrop(transfer)));

  return (
    <>
      {dropping ? (
        <div className="drop-overlay" aria-hidden="true">
          Drop to import. This replaces the current workspace.
        </div>
      ) : null}

      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>

      <header className="app-header">
        <div className="app-title">
          <h1>
            <img className="app-logo" src="/favicon.svg" alt="" width={24} height={24} />
            TerraVisual
          </h1>
          <p className="tagline">
            See the infrastructure your Terraform describes, as you write it.
          </p>
        </div>

        <div className="app-actions">
          <button
            type="button"
            className="action"
            aria-expanded={panel === 'examples'}
            aria-controls="header-panel"
            onClick={() => toggle('examples')}
          >
            Examples
          </button>
          <button
            type="button"
            className="action"
            aria-expanded={panel === 'import'}
            aria-controls="header-panel"
            onClick={() => toggle('import')}
          >
            {panel === 'import' ? 'Close import' : 'Import project'}
          </button>
          <ShareButton files={() => workspace.snapshot()} />
          <button
            type="button"
            className="action"
            onClick={() => {
              // Reset discards the stored workspace too, so there is no undo.
              if (window.confirm('Discard this workspace and go back to the example?')) {
                session.reset();
                navigation.forget();
              }
            }}
          >
            Reset
          </button>
        </div>
      </header>

      <div id="header-panel" className="header-panel">
        {panel === 'examples' ? (
          <ExamplesPanel
            onOpen={(example) => {
              if (!window.confirm(`Replace this workspace with the "${example.title}" example?`)) {
                return;
              }
              session.replace(example.files, 'example');
              navigation.forget();
              setPanel(null);
            }}
          />
        ) : null}
        {panel === 'import' ? <ImportPanel onEntries={(read) => void importer.run(read)} /> : null}
        <ImportReport
          progress={importer.progress}
          report={importer.report}
          onDismiss={importer.dismissReport}
        />
      </div>

      {session.loading ? (
        <p className="app-loading" role="status">
          Loading your workspace…
        </p>
      ) : null}

      <main
        id="workspace"
        className="workspace"
        style={
          { '--code-share': `${split}fr`, '--diagram-share': `${100 - split}fr` } as CSSProperties
        }
      >
        <section className="pane pane-editor" aria-labelledby="editor-heading">
          <div className="pane-header">
            <h2 id="editor-heading">Code</h2>
          </div>

          <FileBar
            paths={paths}
            activePath={activePath}
            onOpen={navigation.openFile}
            onCreate={(input) => {
              const checked = checkNewPath(input, (path) => workspace.has(path));
              if (!checked.ok) return checked.message;
              const refused = attempt(() => workspace.write(checked.path, ''));
              if (refused) return refused;
              navigation.openFile(checked.path);
              return null;
            }}
            onRename={(input) => {
              const checked = checkNewPath(
                input,
                (path) => path !== activePath && workspace.has(path),
              );
              if (!checked.ok) return checked.message;
              const refused = attempt(() => workspace.rename(activePath, checked.path));
              if (refused) return refused;
              navigation.openFile(checked.path);
              return null;
            }}
            onDelete={() => {
              if (!window.confirm(`Delete ${activePath}? This cannot be undone.`)) return;
              workspace.remove(activePath);
              navigation.openFile(workspace.list()[0] ?? '');
            }}
          />

          <Editor
            // A new workspace is a new document, never an edit to the old one.
            key={session.generation}
            path={activePath}
            content={workspace.read(activePath) ?? ''}
            diagnostics={diagnostics}
            reveal={navigation.reveal}
            onChange={(next) => workspace.write(activePath, next)}
            onCursorLine={navigation.followCursor}
          />
        </section>

        <Splitter value={split} onChange={setSplit} />

        <section className="pane pane-diagram" aria-labelledby="diagram-heading">
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
              {analysis.model ? (
                <span className="resource-count">
                  {plural(analysis.model.stats.resources, 'resource')}
                  {analysis.model.stats.truncated ? ', partial' : ''}
                </span>
              ) : null}
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
              key={session.generation}
              model={analysis.model}
              selectedId={navigation.selectedId}
              onSelect={navigation.selectNode}
              onSummarised={setHiddenInDiagram}
            />
          ) : (
            <Outline
              key={session.generation}
              model={analysis.model}
              selectedId={navigation.selectedId}
              onSelect={navigation.selectNode}
            />
          )}
        </section>

        {/* Focusable because it scrolls: a long attribute table must be
            readable without a mouse (WCAG 2.1.1). */}
        <section className="pane pane-details" aria-labelledby="details-heading" tabIndex={0}>
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
        sharedLinkRefused={session.sharedLinkRefused}
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

/** Runs a workspace change, turning a refusal (a limit, say) into what to tell the user. */
function attempt(change: () => void): string | null {
  try {
    change();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'That change could not be made.';
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
