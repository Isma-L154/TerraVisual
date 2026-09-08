import { useCallback, useMemo, useState } from 'react';

import { Editor } from './editor/Editor';
import { DiagnosticsList } from './editor/DiagnosticsList';
import { Diagram } from './diagram/Diagram';
import { NodeDetails } from './diagram/NodeDetails';
import { Outline } from './outline/Outline';
import { STARTER_FILE, STARTER_WORKSPACE } from './app/examples';
import type { Diagnostic, Range } from './model';
import { useAnalysis } from './app/useAnalysis';
import { createWorkspace } from './workspace/workspace';

/**
 * The application shell.
 *
 * The editor and the diagnostics are real. The diagram is not built yet (#10)
 * and says so rather than showing an empty frame that looks like a bug.
 */
export function App() {
  const workspace = useMemo(() => createWorkspace(STARTER_WORKSPACE).workspace, []);
  const [activePath, setActivePath] = useState(STARTER_FILE);
  const [content, setContent] = useState(() => workspace.read(STARTER_FILE) ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'diagram' | 'outline'>('diagram');
  const [reveal, setReveal] = useState<Range | null>(null);

  const analysis = useAnalysis(workspace);

  const handleChange = useCallback(
    (next: string) => {
      setContent(next);
      workspace.write(activePath, next);
    },
    [workspace, activePath],
  );

  const openFile = useCallback(
    (path: string) => {
      setActivePath(path);
      setContent(workspace.read(path) ?? '');
    },
    [workspace],
  );

  /**
   * Jump to a place in the code.
   *
   * A fresh object is stored every time, even for the same range, so clicking
   * the same diagnostic twice scrolls back to it rather than doing nothing.
   */
  const revealSource = useCallback(
    (source: Range) => {
      if (!source.file || source.startLine < 1) return;
      if (source.file !== activePath && workspace.has(source.file)) {
        openFile(source.file);
      }
      setReveal({ ...source });
    },
    [activePath, openFile, workspace],
  );

  const revealDiagnostic = useCallback(
    (diagnostic: Diagnostic) => revealSource(diagnostic.source),
    [revealSource],
  );

  const diagnostics = analysis.model?.diagnostics ?? [];
  const paths = workspace.list();
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

      <main id="workspace" className="workspace">
        <section className="pane pane-editor" aria-labelledby="editor-heading">
          <div className="pane-header">
            <h2 id="editor-heading">Code</h2>
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

          <Editor
            path={activePath}
            content={content}
            diagnostics={diagnostics}
            reveal={reveal}
            onChange={handleChange}
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
            <Diagram model={analysis.model} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <Outline model={analysis.model} selectedId={selectedId} onSelect={setSelectedId} />
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
