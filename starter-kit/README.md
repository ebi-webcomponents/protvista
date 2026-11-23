# ProtVista Starter Kit

A template repository for putting your own protein annotations on screen next to UniProt's — no build step, no npm, no JavaScript.

The page loads the viewer, `protvista-uniprot@5.0.0`, from the jsDelivr CDN. You don't install anything.

## Use it

1. Click **Use this template** at the top of this page, and give your copy a name. Choose **Public** if you want to publish it with GitHub Pages: on a free GitHub account, Pages only works for public repositories.
2. Get the files onto your computer: **Code → Download ZIP**, then unpack it. (If you use Git, cloning works too.)
3. Serve the folder — see below.
4. Open <http://localhost:8000/> in your browser.
5. Edit `config.yaml`, save, reload the page.

**Why step 3 matters.** Browsers refuse to let a page opened straight from disk (a `file://` address) read other local files, so double-clicking `index.html` shows an orange box telling you to use a web server instead. The viewer cannot read its own config any other way.

There are two ways to do it. **Neither requires you to write any code.**

**Without a terminal — publish it.** In your new repository go to **Settings → Pages** and set the source to your default branch. GitHub serves the kit as a real website in a minute or two (the repository must be public on a free account), and you can edit `config.yaml` straight in the GitHub web editor and add your data files with **Add file → Upload files**. This is the simplest route if you have never used a terminal, and it is covered again under [Publish your viewer](#publish-your-viewer).

**With a terminal — run it locally.** You need Python 3, which provides a small built-in web server.

On **Windows**, open the unpacked folder in File Explorer, click the address bar, type `cmd` and press Enter. A Command Prompt opens in that folder. Run:

```bat
py -m http.server 8000 --bind 127.0.0.1
```

If Windows says `'py' is not recognized`, run this instead:

```bat
python -m http.server 8000 --bind 127.0.0.1
```

On **macOS or Linux**, open Terminal, `cd` into the unpacked folder, and run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

If that says *Python was not found*, Python isn't installed. If you use Anaconda, run the command from the **Anaconda Prompt** instead.

Then open <http://localhost:8000/> in your browser.

Leave that window open while you use the viewer; closing it stops the server. Without Python, either [install it from python.org](https://www.python.org/downloads/), use the GitHub Pages route above, or use any other static file server you already have.

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

`type` isn't free text once it's drawn — ProtVista recognises 45 type names
(UniProt feature types plus a few for peptides, epitopes and structure
coverage), each with its own default colour and shape, and renders anything
else as a black rectangle. See
[Feature type and shape vocabulary](https://ebi-webcomponents.github.io/protvista/type-and-shape-vocabulary)
for the full list.

The samples all use [`P05067`](https://www.uniprot.org/uniprotkb/P05067) — amyloid precursor protein, 770 residues — so the coordinates in them make sense. Change `accession:` to your own protein and your own coordinates together.

For TSV, JSON and BED files, and for embedding data directly in the config, see [Load your own data](https://ebi-webcomponents.github.io/protvista/your-data).

## This kit needs internet access — unless you use `sequence:`

As shipped, yes, even with all your data in local files. The config is built around a UniProt accession, and the viewer fetches that protein's sequence before it draws anything, so there is always one network request.

If your protein isn't in UniProt — or the page must not reach the internet — replace `accession:` with `sequence:` and give the viewer the protein itself: a FASTA file in `data/` (`sequence: ./data/my-protein.fasta`) or the residues written into the config. The viewer then makes no request of its own; only your own files are loaded, from the same folder as the page. The component itself still comes from the CDN unless you host it too. See [Proteins outside UniProt](https://ebi-webcomponents.github.io/protvista/sequence-only).

## When something doesn't show up

| What you see | Usual cause |
| --- | --- |
| An orange box saying the viewer could not load | The component itself did not download. Check your connection, or whether your network blocks `cdn.jsdelivr.net`. |
| An orange box saying "Open this page through a web server" | You opened `index.html` directly instead of serving the folder. See step 3. |
| It still says "Loading the viewer…" | Usually a very old browser. Try a current Firefox, Chrome, Edge or Safari. |
| The viewer draws, but your track is empty | The path in `data:` does not resolve. Remember it starts from the folder holding `index.html`, not from `config.yaml`. |
| "No feature data available" | A wrong `accession:`, coordinates past the end of the protein, or a data file that could not be parsed. |
| Your track is empty and you edited the file on Windows | Windows hides file extensions by default, so Notepad may have saved `my-features.csv.txt`. In File Explorer turn on **View → File name extensions** and rename the file. |
| It works on your computer but not on GitHub Pages | Windows ignores the case of file names; GitHub Pages does not. `./data/Hotspots.csv` and `hotspots.csv` are different files once published, so make `data:` match the file name exactly. |
| Garbled text, or "missing required header column" for a file that has the columns | The file isn't UTF-8, or it uses semicolons. In Excel use **Save As → CSV UTF-8 (Comma delimited)**, not "Unicode Text" or plain "CSV". If your Excel still writes semicolons, export from Google Sheets or LibreOffice. See [Spreadsheet exports](https://ebi-webcomponents.github.io/protvista/your-data#spreadsheet-exports). |
| "row … is ragged" or "expected a number" | Usually a decimal comma: write `0.95`, not `0,95`. |
| You suspect your file is malformed | Open the browser's developer console (F12) — a file that fails to parse reports the reason there, naming the row and column. |

More at [Troubleshooting](https://ebi-webcomponents.github.io/protvista/troubleshooting).

## Publish your viewer

In your repository's **Settings → Pages**, set the source to your default branch. On a free GitHub account the repository must be public. GitHub serves the kit as a website within a minute or two, and because it is all static files there is nothing else to configure.

Do check what is in `data/` before you do this. Publishing the site publishes those files too — anyone with the address can read them.

## Getting help

Questions, bugs, and suggestions go to the main [ProtVista repository](https://github.com/ebi-webcomponents/protvista/issues) — your copy of this template has no maintainers watching it. That includes anything in these instructions that confused you, and configs you think others could use.

Want to change ProtVista itself? See [Contributing](https://github.com/ebi-webcomponents/protvista/blob/main/CONTRIBUTING.md#contributing-via-a-fork).

The full documentation is at <https://ebi-webcomponents.github.io/protvista/>, and the [tutorial](https://ebi-webcomponents.github.io/protvista/tutorial) walks through the same ground as this kit in more detail.

## Licensing

The code in this template is licensed under the MIT License (see `LICENSE`).

Documentation and sample data are licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0), unless otherwise stated (see `LICENSE-docs`).

A viewer you build from this template is yours — licence it however you like.

## Funding

This work was supported by the Research Software Maintenance Fund, managed by the Software Sustainability Institute and funded by UKRI grant reference AH/Z000114/1.
