#!/usr/bin/env python3
"""
One-time: download the World English Bible (public domain) and split it into
data/bible/web/<book>/<chapter>.json so the app can show chapters inline.

Source: https://github.com/TehShrike/world-english-bible (JSON per book).
Runs via .github/workflows/bible.yml, or locally: python3 scripts/fetch_bible.py
Standard library only.
"""
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

BOOKS = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
    "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah",
    "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Songs", "Isaiah", "Jeremiah",
    "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
    "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
    "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians",
    "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
    "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter",
    "1 John", "2 John", "3 John", "Jude", "Revelation",
]
# The source repo names files by the "books-of-the-bible" package; a few differ from ours.
SOURCE_NAME = {"Song of Songs": "songofsolomon"}
SRC = "https://raw.githubusercontent.com/TehShrike/world-english-bible/master/json/{slug}.json"
OUT = Path(__file__).resolve().parent.parent / "data" / "bible" / "web"
UA = "Mozilla/5.0 (compatible; FaithPlannerBibleFetch/1.0)"


def slug(book):
    return SOURCE_NAME.get(book, book.lower().replace(" ", ""))


def fetch(url, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise last


def clean(s):
    s = s.replace("’", "’").replace("“", "“").replace("”", "”")
    return re.sub(r"[ \t]+", " ", s).strip()


def split_book(items):
    """-> {chapter: [(verse, text)]} preserving verse order; poetry lines joined with newlines."""
    chapters = {}
    for it in items:
        t = it.get("type", "")
        if "chapterNumber" not in it or "verseNumber" not in it or "value" not in it:
            continue
        ch, v = int(it["chapterNumber"]), int(it["verseNumber"])
        val = it["value"]
        verses = chapters.setdefault(ch, {})
        prev = verses.get(v, "")
        sep = "\n" if (t == "line text" and prev) else (" " if prev else "")
        verses[v] = prev + sep + val
    return {ch: [(v, clean(txt)) for v, txt in sorted(vs.items())] for ch, vs in chapters.items()}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    total_ch = 0
    failures = []
    for book in BOOKS:
        try:
            raw = fetch(SRC.format(slug=slug(book)))
            items = json.loads(raw)
            chapters = split_book(items)
            bdir = OUT / book.lower().replace(" ", "")
            bdir.mkdir(parents=True, exist_ok=True)
            for ch, verses in chapters.items():
                data = {"book": book, "chapter": ch, "translation": "WEB",
                        "verses": [{"v": v, "t": t} for v, t in verses]}
                (bdir / f"{ch}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
            total_ch += len(chapters)
            print(f"✓ {book}: {len(chapters)} chapters")
        except Exception as e:  # noqa: BLE001
            failures.append(book)
            print(f"✗ {book}: {e}", file=sys.stderr)
    (OUT / "index.json").write_text(json.dumps({
        "translation": "WEB", "name": "World English Bible", "license": "Public domain",
        "source": "https://github.com/TehShrike/world-english-bible",
        "books": [b for b in BOOKS if b not in failures],
    }, ensure_ascii=False))
    print(f"\n{total_ch} chapters written to {OUT}; failed: {failures or 'none'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
