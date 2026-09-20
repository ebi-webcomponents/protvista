/**
 * Serves this repo's `src/default-config.yaml` at `/protvista/default-config.yaml`.
 *
 * The playground's `extend-uniprot` preset needs a base config to `extends:`
 * over the network. It used to name the published jsDelivr copy, which is a
 * file this repo does not control: when the kind vocabulary was renamed, the
 * published copy kept the old names and the preset failed to validate with
 * four `unknown-semantic-kind` errors — on a page whose whole job is to show
 * a config that works.
 *
 * A generated endpoint rather than a file copied into `public/`: the YAML is
 * imported from the one canonical source, so what the site serves is what the
 * repo ships, with nothing to keep in step by hand.
 */

import type { APIRoute } from 'astro';
import defaultConfigYaml from '../../../src/default-config.yaml?raw';

export const GET: APIRoute = () =>
  new Response(defaultConfigYaml, {
    headers: { 'content-type': 'text/yaml; charset=utf-8' },
  });
