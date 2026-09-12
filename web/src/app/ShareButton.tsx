import { useCallback, useState } from 'react';

import { canShare, encodeWorkspace, MAX_SHARE_BYTES } from '../persistence/share';

type ShareButtonProps = {
  files: () => Record<string, string>;
};

/**
 * Turns the workspace into a link. The message says the link contains the
 * code, because somebody about to paste one into a public channel is
 * publishing their Terraform and should know before they click.
 */
export function ShareButton({ files }: ShareButtonProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const share = useCallback(async () => {
    setStatus('Preparing…');
    const encoded = await encodeWorkspace(files());

    if (!encoded.ok) {
      setLink(null);
      switch (encoded.reason) {
        case 'too-large':
          setStatus(
            `This workspace is too large to fit in a link (${Math.round(encoded.bytes / 1024)} kB compressed, limit ${MAX_SHARE_BYTES / 1024} kB). Nothing was copied.`,
          );
          break;
        case 'unsupported':
          setStatus('This browser cannot compress, so sharing is unavailable here.');
          break;
        default:
          setStatus('The link could not be created.');
      }
      return;
    }

    const url = window.location.origin + window.location.pathname + encoded.fragment;
    setLink(url);

    try {
      await navigator.clipboard.writeText(url);
      setStatus('Link copied. It contains your Terraform.');
    } catch {
      // Clipboard access is refused often enough that the link has to stay
      // somewhere the user can reach it.
      setStatus('Copying was blocked, so here is the link:');
    }
  }, [files]);

  if (!canShare()) return null;

  return (
    <div className="share">
      <button type="button" className="file-tab" onClick={() => void share()}>
        Copy share link
      </button>

      {status ? (
        <p className="share-status" role="status" aria-live="polite">
          {status}
        </p>
      ) : null}

      {link ? <input className="share-link" readOnly value={link} aria-label="Share link" /> : null}
    </div>
  );
}
