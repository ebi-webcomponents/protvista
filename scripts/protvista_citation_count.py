"""
Module to fetch paper citations from the OpenAlex API using standard libraries,
sort them by publication date (descending), and export them as a Markdown table.
"""

import argparse
import datetime as dt
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, TypedDict


class Citation(TypedDict):
    """Type definition for a single citation record."""

    title: str
    authors: List[str]
    date: str
    journal: str
    doi: str


OPENALEX_BASE_URL = "https://api.openalex.org/works"
REPO_URL = "https://github.com/ebi-webcomponents/protvista"


def _user_agent(mailto: Optional[str] = None) -> str:
    """Identify the tool; a `mailto` opts into OpenAlex's faster 'polite pool'."""
    contact = f"; mailto:{mailto}" if mailto else ""
    return f"protvista-citation-count (+{REPO_URL}{contact})"


def format_author_string(authors: List[str]) -> str:
    """Formats a list of author names using academic conventions."""
    if not authors:
        return "Unknown Author"
    if len(authors) == 1:
        return authors[0]
    if len(authors) == 2:
        return f"{authors[0]} & {authors[1]}"
    if len(authors) > 6:
        return f"{authors[0]} et al."

    return ", ".join(authors[:-1]) + f", & {authors[-1]}"


def get_all_citations(
    doi: str, max_results: int = 1000, mailto: Optional[str] = None
) -> List[Citation]:
    """
    Fetch citations using OpenAlex with cursor-based pagination.

    Args:
        doi: The Digital Object Identifier of the target paper.
        max_results: The maximum number of citations to retrieve.

    Returns:
        A list of strongly typed dictionaries containing citation metadata.
    """
    print(f"Step 1: Resolving DOI ({doi}) to an OpenAlex ID...\n")
    ua = _user_agent(mailto)

    try:
        resolve_url: str = f"{OPENALEX_BASE_URL}/doi:{doi}"
        req = urllib.request.Request(resolve_url, headers={"User-Agent": ua})

        with urllib.request.urlopen(req, timeout=10) as response:
            work_data: Dict[str, Any] = json.loads(response.read().decode("utf-8"))

        work_id: str = work_data.get("id", "")
        if not work_id:
            print("Error: Could not find OpenAlex ID for this DOI.")
            return []

        short_id: str = work_id.split("/")[-1]
        total_citations: Any = work_data.get("cited_by_count", "Unknown")

        print(f"Target paper has ~{total_citations} citations.")
        print(f"Step 2: Fetching citations for ID {short_id} (Newest First)...\n")

        papers: List[Citation] = []
        cursor: Optional[str] = "*"
        page_num: int = 1

        while cursor and len(papers) < max_results:
            fetch_size: int = min(200, max_results - len(papers))

            # Updated select parameter to publication_date and added sort parameter
            query_params: Dict[str, Any] = {
                "filter": f"cites:{short_id}",
                "select": "id,title,publication_date,authorships,doi,primary_location",
                "sort": "publication_date:desc",
                "per-page": fetch_size,
                "cursor": cursor,
            }
            if mailto:
                query_params["mailto"] = mailto         # OpenAlex "polite pool"

            encoded_params: str = urllib.parse.urlencode(query_params)
            cite_url: str = f"{OPENALEX_BASE_URL}?{encoded_params}"
            cite_req = urllib.request.Request(cite_url, headers={"User-Agent": ua})

            with urllib.request.urlopen(cite_req, timeout=10) as cite_response:
                cite_data: Dict[str, Any] = json.loads(
                    cite_response.read().decode("utf-8")
                )

            results: List[Dict[str, Any]] = cite_data.get("results", [])

            if not results:
                break

            for paper in results:
                title: str = paper.get("title") or "No Title"
                date_str: str = paper.get("publication_date") or "Unknown Date"
                paper_doi: str = paper.get("doi") or ""

                raw_authors: List[Dict[str, Any]] = paper.get("authorships", [])
                author_names: List[str] = []
                for author_data in raw_authors:
                    if "author" in author_data:
                        name = author_data["author"].get("display_name")
                        if name:
                            author_names.append(name)

                journal_name: str = "Unknown Journal/Venue"
                location = paper.get("primary_location")
                if location and isinstance(location, dict):
                    source = location.get("source")
                    if source and isinstance(source, dict):
                        journal_name = (
                            source.get("display_name") or "Unknown Journal/Venue"
                        )

                papers.append(
                    {
                        "title": title,
                        "authors": author_names,
                        "date": date_str,
                        "journal": journal_name,
                        "doi": paper_doi,
                    }
                )

            print(
                f"Fetched page {page_num}: added {len(results)} records. "
                f"(Total so far: {len(papers)})"
            )

            meta: Dict[str, Any] = cite_data.get("meta", {})
            cursor = meta.get("next_cursor")

            page_num += 1
            time.sleep(0.2)

        if len(papers) >= max_results:
            print(f"[!] Reached the {max_results}-record cap; the count may be truncated.")
        print("\n--- Extraction Complete ---\n")
        return papers

    except urllib.error.HTTPError as e:
        if e.code == 429:
            print("HTTP Error 429: rate limited (try --mailto for OpenAlex's polite pool).")
        else:
            print(f"HTTP Error: {e.code} - {e.reason}")
    except urllib.error.URLError as e:
        print(f"URL Error: Failed to reach a server. Reason: {e.reason}")
    except json.JSONDecodeError:
        print("Error: The API did not return valid JSON.")

    return []


if __name__ == "__main__":
    _ap = argparse.ArgumentParser(
        description="Print the citing-works count for the ProtVista paper (OpenAlex). "
                    "Ad-hoc tool — prints the count; nothing is written to the repo "
                    "(citations move too slowly to track per period).")
    _ap.add_argument("--as-of", default=None,
                     help="count only works published on/before this date (YYYY-MM-DD); "
                          "default: include all to date")
    _ap.add_argument("--mailto", default=None,
                     help="contact email for OpenAlex's faster 'polite pool'")
    _ap.add_argument("--list", action="store_true",
                     help="also print the per-work table to stdout")
    _args = _ap.parse_args()

    TARGET_DOI = "10.1093/bioinformatics/btx120"
    papers: List[Citation] = get_all_citations(TARGET_DOI, max_results=500, mailto=_args.mailto)

    if _args.as_of:
        def _on_or_before(date_str: str, cutoff: str) -> bool:
            try:
                dt.date.fromisoformat(date_str)
            except ValueError:
                return False                  # drop "Unknown Date" / malformed dates
            return date_str <= cutoff
        papers = [p for p in papers if _on_or_before(p["date"], _args.as_of)]
        print(f"\n{len(papers)} citing works published on or before {_args.as_of}.")
    else:
        print(f"\n{len(papers)} citing works to date.")

    if _args.list:
        print("\n| Date | Title | Authors | Journal/Venue | DOI |")
        print("| :--- | :--- | :--- | :--- | :--- |")
        for p in papers:
            title = p["title"].replace("|", "&#124;")
            authors = format_author_string(p["authors"]).replace("|", "&#124;")
            journal = p["journal"].replace("|", "&#124;")
            print(f"| {p['date']} | {title} | {authors} | {journal} | {p['doi']} |")
