import { useState, type CSSProperties } from 'react';

import { Editor } from './editor/Editor';
import { DiagnosticsList } from './editor/DiagnosticsList';
import { Diagram } from './diagram/Diagram';
import { NodeDetails } from './diagram/NodeDetails';
import { Outline } from './outline/Outline';
import { Footer } from './app/Footer';
import { AppHeader, type HeaderPanel } from './app/AppHeader';
import { ExamplesPanel } from './app/ExamplesPanel';
import { Splitter } from './app/Splitter';
import { SPLIT } from './app/split';
import { useAnalysis } from './app/useAnalysis';
import { useSession } from './app/useSession';
import { useSourceNavigation } from './app/useSourceNavigation';
import { ImportPanel } from './workspace/ImportPanel';
import { ImportReport } from './workspace/ImportReport';
import { FileBar } from './workspace/FileBar';
import { fileActions } from './workspace/fileActions';
import { entriesFromDrop } from './workspace/import';
import { useFileDrop } from './workspace/useFileDrop';
import { useImport } from './workspace/useImport';
import type { SessionOrigin } from './app/useSession';
import { plural } from './plural';

/** The page: the code, the infrastructure it describes, details, and problems. */
export function App() {
  const session = useSession();
  const { workspace } = session;
  const analysis = useAnalysis(workspace);
  const navigation = useSourceNavigation(workspace, analysis.model);

  const [view, setView] = useState<'diagram' | 'outline'>('diagram');
  const [split, setSplit] = useState<number>(SPLIT.initial);
  // One panel under the header at a time.
  const [panel, setPanel] = useState<HeaderPanel | null>(null);
  const [hiddenInDiagram, setHiddenInDiagram] = useState(0);

  const { paths, activePath } = navigation;
  const diagnostics = analysis.model?.diagnostics ?? [];

  // An import or an example replaces the workspace rather than merging into it.
  const openWorkspace = (files: Record<string, string>, origin: SessionOrigin) => {
    session.replace(files, origin);
    navigation.forget();
    setPanel(null);
  };
  const importer = useImport((files) => openWorkspace(files, 'imported'));
  const dropping = useFileDrop((transfer) => void importer.run(() => entriesFromDrop(transfer)));
  const files = fileActions(workspace, activePath, navigation.openFile);

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

      <AppHeader
        panel={panel}
        onToggle={(next) => setPanel((open) => (open === next ? null : next))}
        files={() => workspace.snapshot()}
        onReset={() => {
          // Reset discards the stored workspace too, so there is no undo.
          if (!window.confirm('Discard this workspace and go back to the example?')) return;
          session.reset();
          navigation.forget();
        }}
      />

      <div id="header-panel" className="header-panel">
        {panel === 'examples' ? (
          <ExamplesPanel
            onOpen={(example) => {
              if (window.confirm(`Replace this workspace with the "${example.title}" example?`)) {
                openWorkspace(example.files, 'example');
              }
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
            onCreate={files.create}
            onRename={files.rename}
            onDelete={() => {
              if (window.confirm(`Delete ${activePath}? This cannot be undone.`)) files.remove();
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
