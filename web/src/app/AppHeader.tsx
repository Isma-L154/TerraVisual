import { ShareButton } from './ShareButton';

export type HeaderPanel = 'import' | 'examples';

type AppHeaderProps = {
  panel: HeaderPanel | null;
  onToggle: (panel: HeaderPanel) => void;
  onReset: () => void;
  files: () => Record<string, string>;
};

/** The product's name and the actions that act on the whole workspace. */
export function AppHeader({ panel, onToggle, onReset, files }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-title">
        <h1>
          <img className="app-logo" src="/favicon.svg" alt="" width={24} height={24} />
          TerraVisual
        </h1>
        <p className="tagline">See the infrastructure your Terraform describes, as you write it.</p>
      </div>

      <div className="app-actions">
        <button
          type="button"
          className="action"
          aria-expanded={panel === 'examples'}
          aria-controls="header-panel"
          onClick={() => onToggle('examples')}
        >
          Examples
        </button>
        <button
          type="button"
          className="action"
          aria-expanded={panel === 'import'}
          aria-controls="header-panel"
          onClick={() => onToggle('import')}
        >
          {panel === 'import' ? 'Close import' : 'Import project'}
        </button>
        <ShareButton files={files} />
        <button type="button" className="action" onClick={onReset}>
          Reset
        </button>
      </div>
    </header>
  );
}
