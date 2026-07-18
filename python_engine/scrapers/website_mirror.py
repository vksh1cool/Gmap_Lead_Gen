"""
Website mirror scraper — powered by HTTrack.

Given a seed URL (or bare domain), mirror the site locally with a bounded
depth / size / time budget, then scan every downloaded HTML page for contact
intelligence: emails (incl. common obfuscations), phone numbers, and social
profiles. Returns a single rich lead per site (the business behind the site),
plus best-effort homepage title / about text.

This is deliberately conservative about what it downloads (HTML/text only, hard
caps on size + time) so a single run can't balloon or hang the engine.
"""

import asyncio
import os
import re
import shutil
import tempfile
import logging
from urllib.parse import urlparse

from scrapers.extract import (
    PHONE_REGEX,
    extract_emails,
    extract_socials,
    valid_phone,
)

logger = logging.getLogger(__name__)

# ── Local-only patterns (extraction lives in scrapers/extract.py) ─────────────
TITLE_REGEX = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
TAG_STRIP_REGEX = re.compile(r"<[^>]+>")

HTML_EXTS = (".html", ".htm", ".php", ".asp", ".aspx", ".jsp", ".txt", ".xml")
# HTTrack reject filters — skip binary / media so the mirror stays lean & fast.
REJECT_FILTERS = [
    "-*.jpg", "-*.jpeg", "-*.png", "-*.gif", "-*.svg", "-*.ico", "-*.bmp", "-*.webp",
    "-*.css", "-*.js", "-*.mjs", "-*.woff", "-*.woff2", "-*.ttf", "-*.eot", "-*.otf",
    "-*.mp4", "-*.webm", "-*.mp3", "-*.wav", "-*.avi", "-*.mov", "-*.pdf", "-*.zip",
    "-*.gz", "-*.rar", "-*.dmg", "-*.exe", "-*.woff*", "-*.map",
]

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _httrack_bin() -> str | None:
    return shutil.which("httrack") or (
        "/opt/local/bin/httrack" if os.path.exists("/opt/local/bin/httrack") else None
    )


def _normalize_seed(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    if not re.match(r"^https?://", url, re.IGNORECASE):
        url = "https://" + url
    return url


async def _run_httrack(seed: str, out_dir: str, depth: int, max_time: int, max_size: int) -> None:
    """Run httrack with a hard wall-clock cap; kill it if it overruns."""
    binp = _httrack_bin()
    if not binp:
        raise RuntimeError("httrack binary not found (install via `brew install httrack` or `port install httrack`)")

    cmd = [
        binp, seed,
        "-O", out_dir,
        f"-r{depth}",       # mirror depth
        "-%e0",             # never follow external links
        f"-E{max_time}",    # max mirror time (s)
        f"-M{max_size}",    # max overall bytes scanned/uploaded
        "-c4",              # 4 sockets
        "-T15",             # per-link timeout
        "-R1",              # 1 retry
        "-s0",              # ignore robots.txt (user opted into aggressive scraping)
        "-F", USER_AGENT,
        "-q", "-Q",         # quiet, no log file
        "-A200000",         # per-file rate/length guard for non-html
    ] + REJECT_FILTERS

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        # Hard cap = mirror budget + a grace window for flush/exit.
        await asyncio.wait_for(proc.wait(), timeout=max_time + 25)
    except asyncio.TimeoutError:
        logger.warning("httrack overran budget for %s — terminating", seed)
        try:
            proc.terminate()
            await asyncio.wait_for(proc.wait(), timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


def _scan_mirror(out_dir: str) -> dict:
    """Walk the mirrored files and aggregate contact intelligence."""
    emails: set[str] = set()
    phones: list[str] = []
    socials: set[str] = set()
    pages = 0
    homepage_title = ""
    homepage_text = ""

    seen_phone_digits: set[str] = set()

    for root, dirs, files in os.walk(out_dir):
        # Skip HTTrack's own bookkeeping dirs (cache, logs).
        dirs[:] = [d for d in dirs if d not in ("hts-cache",)]
        # The real site lives under out_dir/<domain>/… — files sitting directly
        # in out_dir root are HTTrack-generated (its offline "Local index",
        # cookies, error logs), so ignore that level entirely.
        if os.path.abspath(root) == os.path.abspath(out_dir):
            continue
        for fname in files:
            if not fname.lower().endswith(HTML_EXTS):
                continue
            fpath = os.path.join(root, fname)
            try:
                with open(fpath, "r", encoding="utf-8", errors="ignore") as fh:
                    raw = fh.read()
            except Exception:
                continue
            # Belt-and-suspenders: never treat an HTTrack-authored page as content.
            if "HTTrack Website Copier" in raw and "Local index" in raw:
                continue
            pages += 1

            for e in extract_emails(raw):
                emails.add(e)
            for s in extract_socials(raw):
                socials.add(s)

            # Phones only from visible-ish text to cut false positives.
            # Collapse all whitespace first so numbers can't span tabs/newlines.
            text = re.sub(r"\s+", " ", TAG_STRIP_REGEX.sub(" ", raw))
            for pm in PHONE_REGEX.findall(text):
                v = valid_phone(pm)
                if v:
                    d = re.sub(r"\D", "", v)
                    if d not in seen_phone_digits:
                        seen_phone_digits.add(d)
                        phones.append(v)

            # Capture homepage-ish title/text (shallowest index page wins).
            is_indexish = fname.lower().startswith("index") or pages == 1
            if is_indexish and not homepage_title:
                tm = TITLE_REGEX.search(raw)
                if tm:
                    homepage_title = re.sub(r"\s+", " ", tm.group(1)).strip()[:200]
            if is_indexish and len(homepage_text) < 200:
                clean = re.sub(r"\s+", " ", text).strip()
                if len(clean) > len(homepage_text):
                    homepage_text = clean[:600]

    return {
        "emails": sorted(emails),
        "phones": phones[:5],
        "socials": sorted(socials)[:10],
        "pages": pages,
        "title": homepage_title,
        "about": homepage_text,
    }


async def scrape_website_mirror(seed_url: str, depth: int = 2, max_time: int = 90):
    """
    Async generator yielding NDJSON-ready dict events:
      {"type": "info", "message": ...}
      {"type": "warning", "message": ...}
      <lead dict>                     (the enriched website lead)
    """
    seed = _normalize_seed(seed_url)
    if not seed:
        yield {"type": "error", "message": "No website URL provided."}
        return

    domain = urlparse(seed).netloc or seed
    if not _httrack_bin():
        yield {"type": "error", "message": "HTTrack is not installed on this machine. Install it (brew install httrack) and retry."}
        return

    # Clamp inputs so the UI can't request an unbounded crawl.
    depth = max(1, min(int(depth or 2), 4))
    max_time = max(20, min(int(max_time or 90), 300))
    max_size = 12_000_000  # 12 MB total mirror cap

    tmp = tempfile.mkdtemp(prefix="httrack_")
    try:
        yield {"type": "info", "message": f"Mirroring {domain} (depth {depth}, up to {max_time}s)…"}
        try:
            await _run_httrack(seed, tmp, depth, max_time, max_size)
        except Exception as exc:
            yield {"type": "error", "message": f"HTTrack failed: {exc}"}
            return

        yield {"type": "info", "message": f"Scanning mirrored pages of {domain} for contacts…"}
        scan = await asyncio.to_thread(_scan_mirror, tmp)

        if scan["pages"] == 0:
            yield {"type": "warning", "message": f"Could not download any pages from {domain} (blocked, offline, or JS-only site)."}
            return

        yield {
            "type": "info",
            "message": f"{domain}: scanned {scan['pages']} pages — {len(scan['emails'])} email(s), {len(scan['phones'])} phone(s), {len(scan['socials'])} social link(s).",
        }

        lead = {
            "name": scan["title"] or domain,
            "website": seed,
            "platform": "website",
            "kind": "website",
            "address": domain,
            "phone": scan["phones"][0] if scan["phones"] else "",
            "emails_found": scan["emails"],
            "socials": scan["socials"],
            "about_snippet": scan["about"],
            "title": scan["title"] or domain,
            "category": "Website",
            "reviews": str(scan["pages"]),   # reuse "reviews" slot as pages-crawled count
            "rating": "",
            "external_id": f"website:{domain}",
            "post_url": seed,
        }
        yield lead
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
