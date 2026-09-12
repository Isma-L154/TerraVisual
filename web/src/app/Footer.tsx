import { ShareButton } from './ShareButton';
import type { SessionOrigin } from './useSession';

type FooterProps = {
  origin: SessionOrigin;
  storageAvailable: boolean;
  files: () => Record<string, string>;
};

export function Footer({ origin, storageAvailable, files }: FooterProps) {
  return (
    <footer className="app-footer">
      <ShareButton files={files} />

      {origin === 'shared' ? (
        <p className="footer-note">
          This workspace came from a shared link. Editing it changes only your copy.
        </p>
      ) : null}
      {origin === 'restored' ? <p className="footer-note">Restored from your last visit.</p> : null}
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

      <PrivacyDetail />
    </footer>
  );
}

/**
 * What the privacy claim covers and what no website can promise, one step from
 * the claim itself. Closed by default, so it interrupts nobody.
 */
function PrivacyDetail() {
  return (
    <details className="privacy-detail">
      <summary>What that covers, and what it cannot</summary>

      <p>
        <strong>The application sends nothing.</strong> There is no server to send it to: your
        Terraform is parsed and drawn here, and the page is only allowed to talk to its own origin,
        which the browser enforces rather than us promising it.
      </p>
      <p>
        <strong>A share link contains your code.</strong> That is how sharing works without a server
        — the workspace travels compressed inside the link, which is never sent in the request, but
        anyone holding the link has the code.
      </p>
      <p>
        <strong>Browser extensions are outside this.</strong> An extension you have installed can
        read any page you open, including this one, and no website can prevent that. If you are
        working with something sensitive, that is worth knowing here as much as anywhere else.
      </p>
      <p>
        Importing a project skips <code>.tfstate</code> files and generated directories, because
        state files routinely contain secrets.
      </p>
    </details>
  );
}
