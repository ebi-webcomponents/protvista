# Recipes

Alternative configurations you can try without editing anything. Each one is a
complete config file — the same shape as the `config.yaml` in the folder above.

Two ways to use one:

- **Preview it.** Open `index.html?config=recipes/<name>.yaml` in your browser.
  Nothing on disk changes, so you can flip back by removing the `?config=` part.
- **Adopt it.** Copy the file over `config.yaml`, then edit it as your own.

| Recipe | What it shows |
| --- | --- |
| [`tsv.yaml`](./tsv.yaml) | A tab-separated file instead of CSV, with the track inside a named group |
| [`extend-uniprot.yaml`](./extend-uniprot.yaml) | Your track layered on top of the full UniProt viewer via `extends:` |

Both recipes read from the shared `../data/` folder, so they work from the same
page without moving any files around.

A note on publishing: if you push your copy of this kit to GitHub Pages, whatever
sits in `data/` becomes publicly readable. Move anything unpublished out before
you publish.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
