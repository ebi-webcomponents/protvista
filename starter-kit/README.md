# ProtVista Starter Kit

A template repository for putting your own protein annotations on screen next to UniProt's — no build step, no npm, no JavaScript.

<!-- protvista:unpublished:start -->
**Read this first: this template does not work yet**

> ProtVista 5.0.0-beta.1 has not been published to npm. `index.html` pins `protvista-uniprot@5.0.0-beta.1` on jsDelivr, that address returns "not found" today, and the page shows a "Could not load the viewer" box instead of a protein.
>
> Everything else in the kit is real and final — the config, the sample data, the validation, the layout. Nothing here needs to change when 5.0.0-beta.1 ships; the same files simply start working. Watch [the releases page](https://github.com/ebi-webcomponents/protvista/releases), then reload.
>
> To see the same configuration working right now, open the [ProtVista playground](https://ebi-webcomponents.github.io/protvista/playground/).
<!-- protvista:unpublished:end -->

## Use it

1. Click **Use this template** at the top of this page, and give your copy a name.
2. Get the files onto your computer: **Code → Download ZIP**, then unpack it. (If you use Git, cloning works too.)
3. Serve the folder — see below.
4. Open the address the server prints, usually <http://localhost:8000/>.
5. Edit `config.yaml`, save, reload the page.

**Why step 3 matters.** Browsers refuse to let a page opened straight from disk (a `file://` address) read other local files, so double-clicking `index.html` shows an orange box telling you to use a web server instead. The viewer cannot read its own config any other way.

There are two ways to do it. **Neither requires you to write any code.**

**Without a terminal — publish it.** In your new repository go to **Settings → Pages** and set the source to your default branch. GitHub serves the kit as a real website in a minute or two, and you can edit `config.yaml` straight in the GitHub web editor. This is the simplest route if you have never used a terminal, and it is covered again under [Publish your viewer](#publish-your-viewer).

**With a terminal — run it locally.** Open **Terminal** on macOS or Linux, or **Command Prompt** on Windows, move into the unpacked folder (`cd` followed by the folder's path), and run one of:

```sh
python3 -m http.server 8000    # macOS / Linux
py -m http.server 8000         # Windows
```

Leave that window open while you use the viewer; closing it stops the server. If the command is not found, you do not have Python installed — use the GitHub Pages route above instead, or any other static file server you already have.

## What's in here

| Path | What it is |
| --- | --- |
| `index.html` | The page. You will rarely need to touch it. |
| `config.yaml` | Your viewer: which protein, which tracks, which files. This is the file you edit. |
| `data/` | Your annotation files. Three samples ship here. |
| `recipes/` | Alternative configs to try — see [`recipes/README.md`](./recipes/README.md). |
| `.github/workflows/` | An automatic check on `config.yaml` — see below. |

### About the automatic check

Your copy comes with one GitHub Action that validates `config.yaml` against ProtVista's published schema every time you push. If you mistype a setting, the repository shows a red ✕ and GitHub emails you — that is the check telling you the config is wrong, not your repository being broken. Open the failed run to see which field it objected to.

It is a convenience, not a requirement. If you would rather not have it, delete the `.github/` folder; nothing else depends on it.

## Put your own data in

Drop a CSV or TSV file into `data/`, then point `config.yaml` at it. The file needs a header row with these columns:

| Column | Required | What it holds |
| --- | --- | --- |
| `type` | yes | The kind of feature, e.g. `DOMAIN`, `BINDING`, `REGION`, `MUTAGEN` |
| `start` | yes | First residue, counting from 1 |
| `end` | yes | Last residue. Same as `start` for a single-residue feature. |
| `description` | yes | Free text, shown in the tooltip |
| `score` | no | A number, if you have one |

So a minimal file looks like this:

```csv
type,start,end,description,score
DOMAIN,18,289,Extracellular domain (custom re-annotation),0.95
BINDING,132,140,Predicted heparin-binding site,0.87
```

and `config.yaml` points at it like this:

```yaml
data: ./data/my-features.csv
```

One thing that catches people out: paths in `data:` are resolved against **the page**, not against `config.yaml`. They start from the folder holding `index.html`. Keep your files under `data/` and the `./data/…` form always works.

The samples all use [`P05067`](https://www.uniprot.org/uniprotkb/P05067) — amyloid precursor protein, 770 residues — so the coordinates in them make sense. Change `accession:` to your own protein and your own coordinates together.

For TSV, JSON and BED files, and for embedding data directly in the config, see [Load your own data](https://ebi-webcomponents.github.io/protvista/your-data).

## This kit needs internet access

Even with all your data in local files. The viewer is built around a UniProt accession and fetches that protein's sequence before it draws anything, so there is always one network request. It is not an offline tool.

## When something doesn't show up

| What you see | Usual cause |
| --- | --- |
| An orange box saying the viewer could not load | The component itself did not download — see the note at the top of this file, or check your connection. |
| An orange box saying "Open this page through a web server" | You opened `index.html` directly instead of serving the folder. See step 3. |
| It still says "Loading the viewer…" | Usually a very old browser. Try a current Firefox, Chrome, Edge or Safari. |
| The viewer draws, but your track is empty | The path in `data:` does not resolve. Remember it starts from the folder holding `index.html`, not from `config.yaml`. |
| "No feature data available" | A wrong `accession:`, coordinates past the end of the protein, or a data file that could not be parsed. |
| You suspect your file is malformed | Open the browser's developer console (F12) — a file that fails to parse reports the reason there, naming the row and column. |

More at [Troubleshooting](https://ebi-webcomponents.github.io/protvista/troubleshooting).

## Publish your viewer

In your repository's **Settings → Pages**, set the source to your default branch. GitHub serves the kit as a website within a minute or two, and because it is all static files there is nothing else to configure.

Do check what is in `data/` before you do this. Publishing the site publishes those files too — anyone with the address can read them.

## Getting help

Questions, bugs, and suggestions go to the main [ProtVista repository](https://github.com/ebi-webcomponents/protvista/issues) — your copy of this template has no maintainers watching it.

The full documentation is at <https://ebi-webcomponents.github.io/protvista/>, and the [tutorial](https://ebi-webcomponents.github.io/protvista/tutorial) walks through the same ground as this kit in more detail.

## Licensing

The code in this template is licensed under the MIT License (see `LICENSE`).

Documentation and sample data are licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0), unless otherwise stated (see `LICENSE-docs`).

A viewer you build from this template is yours — licence it however you like.

## Funding

This work was supported by the Research Software Maintenance Fund, managed by the Software Sustainability Institute and funded by UKRI grant reference AH/Z000114/1.
