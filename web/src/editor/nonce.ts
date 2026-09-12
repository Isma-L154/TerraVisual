/**
 * The CSP nonce the deployment Worker wrote into this page, which CodeMirror
 * needs for its runtime stylesheet. Empty under the Vite dev server, which
 * sets no policy.
 */
export function cspNonce(): string {
  if (typeof document === 'undefined') return '';
  return document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? '';
}
