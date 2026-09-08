import { useCallback, useMemo, useState } from 'react';

import { Editor } from './editor/Editor';
import { DiagnosticsList } from './editor/DiagnosticsList';
import { Diagram } from './diagram/Diagram';
import { NodeDetails } from './diagram/NodeDetails';
import { STARTER_FILE, STARTER_WORKSPACE } from './app/examples';
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
            onChange={handleChange}
          />
        </section>

        <section className="pane" aria-labelledby="diagram-heading">
          <div className="pane-header">
            <h2 id="diagram-heading">Infrastructure</h2>
            <AnalysisStatus analyzing={analysis.analyzing} error={analysis.error} />
          </div>

          <Diagram model={analysis.model} selectedId={selectedId} onSelect={setSelectedId} />
        </section>

        <section className="pane pane-details" aria-labelledby="details-heading">
          <div className="pane-header">
            <h2 id="details-heading">Details</h2>
          </div>
          <NodeDetails node={selected} />
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
            <DiagnosticsList diagnostics={diagnostics} />
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
