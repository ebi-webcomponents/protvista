/**
 * External URL template registry for tooltip rendering.
 *
 * Every external link referenced inside a tooltip passes through
 * `expandLink(source, params)`. Values are URL strings containing one or
 * more `{name}` placeholders. `expandLink('pubmed', '12345')` is shorthand
 * for `expandLink('pubmed', { id: '12345' })`; the multi-param form is
 * used for templates with more than one placeholder (e.g. InterPro, where
 * the entry URL carries both a source database and an accession).
 *
 * Replacing entries in this map is the single override point for
 * embedders pointing at internal mirrors (e.g. an intranet copy of
 * PubMed or a regional ProteomeXchange mirror). The built-in entries
 * match the URLs previously hardcoded inside the per-kind tooltip
 * files.
 */
import type { TooltipLinkRegistry } from './types';

export const tooltipLinks: TooltipLinkRegistry = {
  /** PubMed article — Europe PMC / NCBI landing page. */
  pubmed: 'https://pubmed.ncbi.nlm.nih.gov/{id}',
  /** Europe PMC article view (same article via a different portal). */
  europepmc: 'https://europepmc.org/article/MED/{id}',
  /** ProteomeXchange dataset landing page. */
  proteomexchange: 'https://proteomecentral.proteomexchange.org/dataset/{id}',
  /** ProteomeXchange USI spectrum viewer (for PTM evidence spectra). */
  'proteomexchange-usi':
    'http://proteomecentral.proteomexchange.org/usi/?usi={id}',
  /** PRIDE project archive (fallback for ProteomeXchange datasets). */
  pride: 'https://www.ebi.ac.uk/pride/archive/projects/{id}',
  /** PeptideAtlas build detail page (parameterized by build id, not UP acc). */
  peptideatlas:
    'https://db.systemsbiology.net/sbeams/cgi/PeptideAtlas/buildDetails?atlas_build_id={id}',
  /** Unimod modification catalog (editid1 numeric key). */
  unimod: 'https://www.unimod.org/modifications_view.php?editid1={id}',
  /** InterPro entry page — requires `source` and `id` placeholders. */
  interpro: 'https://www.ebi.ac.uk/interpro/entry/{source}/{id}/',
  /** InterPro parent entry of an integrated signature. */
  'interpro-integrated': 'https://www.ebi.ac.uk/interpro/entry/InterPro/{id}/',
  /** Ensembl COVID-19 variant explore page. */
  'ensembl-covid':
    'https://covid-19.ensembl.org/Sars_cov_2/Variation/Explore?v={id}',
  /** Ensembl stable identifier landing page. */
  ensembl: 'https://www.ensembl.org/id/{id}',
  /** REDIportal RNA-editing atlas (hg38 assembly, dev backend). */
  rediportal:
    'http://srv00.recas.ba.infn.it/cgi/atlas/getpage_dev.py?query9=hg&query10=hg38&acc={id}',
};

/**
 * Expand a registered URL template against one or more placeholder values.
 *
 *   expandLink('pubmed', '12345')                  → https://.../12345
 *   expandLink('interpro', { source: 'pfam', id: 'PF001' })
 *                                                   → https://.../pfam/PF001/
 *
 * Behaviour notes:
 *   - Unknown `source` → the raw `params` (or `params.id`) is returned,
 *     so callers can wrap a missing registry entry without an obvious
 *     error in the tooltip. This matches the pre-refactor behaviour of
 *     tooltip files that used string concatenation against hardcoded
 *     URLs; a missing template leaves the ID visible.
 *   - Every substituted value is `encodeURIComponent`-escaped. Callers
 *     pass raw IDs, the helper handles URL safety.
 *   - Missing placeholders are substituted with an empty string — the
 *     resulting URL may 404 but the template expansion itself won't
 *     throw. Callers are responsible for passing complete param maps.
 */
export function expandLink(
  source: string,
  params: string | Record<string, string>
): string {
  const dict: Record<string, string> =
    typeof params === 'string' ? { id: params } : params;
  const template = tooltipLinks[source];
  if (!template) return dict.id ?? '';
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    encodeURIComponent(dict[key] ?? '')
  );
}
