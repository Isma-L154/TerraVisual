/**
 * The Content Security Policy nonce for this page load.
 *
 * CodeMirror mounts its theme as a `<style>` element at runtime. Under a policy
 * of `style-src 'self' 'nonce-…'` that element is refused unless it carries the
 * nonce, so the editor would come up with no styling at all — which is why this
 * exists rather than being an optional extra.
 *
 * The deployment Worker generates a fresh nonce per response and writes it into
 * the page as a `<meta>` tag. There is nothing secret about it: a nonce is not a
 * credential, it is proof that markup came from the response rather than from an
 * injection, and it stops being useful the moment the page is reloaded.
 */

const META = 'meta[name="csp-nonce"]';

/**
 * Reads the nonce, or an empty string when there is none.
 *
 * An empty string is the right answer for the development server, where Vite
 * serves the page without a Worker in front of it and there is no policy to
 * satisfy. CodeMirror's facet treats it as "no nonce", so the editor works in
 * both places without either knowing about the other.
 */
export function cspNonce(): string {
  if (typeof document === 'undefined') return '';
  return document.querySelector<HTMLMetaElement>(META)?.content ?? '';
}
