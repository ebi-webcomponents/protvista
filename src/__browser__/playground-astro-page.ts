/**
 * The playground page as it ships: the body markup and the stylesheet of
 * `docs/src/pages/playground.astro`, with the page's few Astro expressions
 * resolved to what the built page renders. For the accessibility specs,
 * which check the real page's landmarks, tab order and layout rather than
 * the minimal skeleton in `playground-page.ts`. Pass {@link PAGE_MARKUP} to
 * `openPlayground({ markup })` and call {@link installPageStyles} first.
 */
import pageSource from '../../docs/src/pages/playground.astro?raw';

function extract(pattern: RegExp, what: string): string {
  const match = pageSource.match(pattern);
  if (!match) throw new Error(`playground.astro: no ${what} found`);
  return match[1];
}

/** The `<body>` content, without the client script and the style block. */
export const PAGE_MARKUP = extract(
  /<body>([\s\S]*?)<!-- Client-only/,
  '<body> content'
)
  .replace(/class:list=\{\['(\w+)',[^\]]*\]\}/, 'class="$1 is-prerelease"')
  .replace(/\s\w+=\{\w+\}/g, '')
  .replace(/\{version\}/g, '0.0.0-test');

/** The page's global stylesheet. */
export const PAGE_CSS = extract(
  /<style is:global>([\s\S]*?)<\/style>/,
  '<style is:global>'
);

/** Add the page's stylesheet and `<html lang>`; returns an undo. */
export function installPageStyles(): () => void {
  const style = document.createElement('style');
  style.textContent = PAGE_CSS;
  document.head.append(style);
  const lang = document.documentElement.getAttribute('lang');
  document.documentElement.setAttribute('lang', 'en');
  const title = document.title;
  document.title = 'ProtVista configuration playground';
  return () => {
    style.remove();
    if (lang === null) document.documentElement.removeAttribute('lang');
    else document.documentElement.setAttribute('lang', lang);
    document.title = title;
  };
}
