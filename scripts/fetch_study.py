#!/usr/bin/env python3
"""
Builds per-chapter study material into data/study/<book>/<chapter>.json from
two openly licensed sources:

  1. unfoldingWord® translationQuestions (en_tq) — CC BY-SA 4.0
     https://git.door43.org/unfoldingWord/en_tq   (TSV per book)
  2. Matthew Henry's Concise Commentary — public domain, via CCEL ThML
     https://ccel.org/ccel/h/henry/mhcc.xml

Run by .github/workflows/study.yml (one time / on demand). Standard library only.
"""
import csv
import html
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

BOOKS = [  # (our name, USFM code, MHCC title variants)
    ("Genesis", "GEN"), ("Exodus", "EXO"), ("Leviticus", "LEV"), ("Numbers", "NUM"), ("Deuteronomy", "DEU"),
    ("Joshua", "JOS"), ("Judges", "JDG"), ("Ruth", "RUT"), ("1 Samuel", "1SA"), ("2 Samuel", "2SA"),
    ("1 Kings", "1KI"), ("2 Kings", "2KI"), ("1 Chronicles", "1CH"), ("2 Chronicles", "2CH"), ("Ezra", "EZR"),
    ("Nehemiah", "NEH"), ("Esther", "EST"), ("Job", "JOB"), ("Psalms", "PSA"), ("Proverbs", "PRO"),
    ("Ecclesiastes", "ECC"), ("Song of Songs", "SNG"), ("Isaiah", "ISA"), ("Jeremiah", "JER"), ("Lamentations", "LAM"),
    ("Ezekiel", "EZK"), ("Daniel", "DAN"), ("Hosea", "HOS"), ("Joel", "JOL"), ("Amos", "AMO"), ("Obadiah", "OBA"),
    ("Jonah", "JON"), ("Micah", "MIC"), ("Nahum", "NAM"), ("Habakkuk", "HAB"), ("Zephaniah", "ZEP"), ("Haggai", "HAG"),
    ("Zechariah", "ZEC"), ("Malachi", "MAL"), ("Matthew", "MAT"), ("Mark", "MRK"), ("Luke", "LUK"), ("John", "JHN"),
    ("Acts", "ACT"), ("Romans", "ROM"), ("1 Corinthians", "1CO"), ("2 Corinthians", "2CO"), ("Galatians", "GAL"),
    ("Ephesians", "EPH"), ("Philippians", "PHP"), ("Colossians", "COL"), ("1 Thessalonians", "1TH"),
    ("2 Thessalonians", "2TH"), ("1 Timothy", "1TI"), ("2 Timothy", "2TI"), ("Titus", "TIT"), ("Philemon", "PHM"),
    ("Hebrews", "HEB"), ("James", "JAS"), ("1 Peter", "1PE"), ("2 Peter", "2PE"), ("1 John", "1JN"), ("2 John", "2JN"),
    ("3 John", "3JN"), ("Jude", "JUD"), ("Revelation", "REV"),
]
# MHCC uses a few different titles.
MHCC_ALIASES = {
    "song of solomon": "Song of Songs", "canticles": "Song of Songs", "psalm": "Psalms",
    "revelation of john": "Revelation", "the revelation": "Revelation", "acts of the apostles": "Acts",
    "i samuel": "1 Samuel", "ii samuel": "2 Samuel", "i kings": "1 Kings", "ii kings": "2 Kings",
    "i chronicles": "1 Chronicles", "ii chronicles": "2 Chronicles", "i corinthians": "1 Corinthians",
    "ii corinthians": "2 Corinthians", "i thessalonians": "1 Thessalonians", "ii thessalonians": "2 Thessalonians",
    "i timothy": "1 Timothy", "ii timothy": "2 Timothy", "i peter": "1 Peter", "ii peter": "2 Peter",
    "i john": "1 John", "ii john": "2 John", "iii john": "3 John",
}
TQ_URL = "https://git.door43.org/unfoldingWord/en_tq/raw/branch/master/tq_{code}.tsv"
MHCC_URL = "https://ccel.org/ccel/h/henry/mhcc.xml"
OUT = Path(__file__).resolve().parent.parent / "data" / "study"
UA = "Mozilla/5.0 (compatible; FaithPlannerStudyFetch/1.0)"


def fetch(url, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    raise last


def slug(book):
    return book.lower().replace(" ", "")


# ---------------------------------------------------------------- translationQuestions
def parse_tq(tsv_text):
    """-> {chapter: [{"ref": "1:1-3", "q": ..., "a": ...}]}"""
    rows = list(csv.reader(io.StringIO(tsv_text), delimiter="\t", quoting=csv.QUOTE_NONE))
    if not rows:
        return {}
    header = [h.strip().lower() for h in rows[0]]
    def col(*names):
        for n in names:
            if n in header:
                return header.index(n)
        return None
    i_ref, i_q, i_a = col("reference"), col("question"), col("response", "answer")
    if i_ref is None or i_q is None:
        raise ValueError(f"unexpected TSV header: {header}")
    out = {}
    for r in rows[1:]:
        if len(r) <= max(i_ref, i_q):
            continue
        ref, q = r[i_ref].strip(), r[i_q].strip()
        a = r[i_a].strip() if i_a is not None and len(r) > i_a else ""
        m = re.match(r"(\d+):(\d+)", ref)
        if not m or not q:
            continue
        ch = int(m.group(1))
        out.setdefault(ch, []).append({"ref": ref, "q": q, "a": a})
    return out


# ---------------------------------------------------------------- Matthew Henry (ThML)
TAG = re.compile(r"<[^>]+>")


def clean(s):
    s = re.sub(r"<note[^>]*>.*?</note>", "", s, flags=re.S)
    s = TAG.sub("", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def parse_mhcc(xml_text):
    """-> {book: {chapter: [{"ref": "Verses 1-2", "text": ...}, ...]}}  (chapter 0 = book intro)"""
    out = {}
    known = {b.lower(): b for b, _ in BOOKS}
    for m in re.finditer(r'<div1\b([^>]*)>(.*?)(?=<div1\b|</ThML.body>|\Z)', xml_text, flags=re.S):
        attrs, body = m.group(1), m.group(2)
        t = re.search(r'title="([^"]*)"', attrs)
        title = html.unescape(t.group(1)).strip() if t else ""
        key = title.lower().strip()
        book = known.get(key) or MHCC_ALIASES.get(key)
        if not book:
            # e.g. "The First Book of Moses, called Genesis" → try to find a known name inside
            for k, v in known.items():
                if re.search(r"\b" + re.escape(k) + r"\b", key):
                    book = v
                    break
        if not book:
            continue
        chapters = {}
        # split into div2 blocks
        parts = re.split(r'(<div2\b[^>]*>)', body)
        intro = parts[0]
        chapters[0] = paragraphs(intro)
        for i in range(1, len(parts), 2):
            head, content = parts[i], parts[i + 1] if i + 1 < len(parts) else ""
            tt = re.search(r'title="([^"]*)"', head)
            ct = html.unescape(tt.group(1)) if tt else ""
            cm = re.search(r"(\d+)", ct)
            if not cm:
                continue
            chapters[int(cm.group(1))] = paragraphs(content)
        out[book] = {ch: ps for ch, ps in chapters.items() if ps}
    return out


def paragraphs(block):
    """Turn a div2 body into [{"ref": heading, "text": paragraph}] using scripCom markers as headings."""
    items = []
    current_ref = ""
    for pm in re.finditer(r"<p\b[^>]*>(.*?)</p>", block, flags=re.S):
        inner = pm.group(1)
        sc = re.search(r'<scripCom\b[^>]*passage="([^"]*)"', inner)
        if sc:
            passage = html.unescape(sc.group(1))
            vm = re.search(r"(\d+):([\d,\-–]+)", passage)
            current_ref = ("Verses " + vm.group(2).replace("-", "–")) if vm else passage
        text = clean(inner)
        if not text or re.fullmatch(r"(Chapter \d+|\d+)", text):
            continue
        # Drop chapter outlines that are just verse links, keep prose.
        if len(text) < 40 and re.match(r"^\(?\d", text):
            continue
        items.append({"ref": current_ref, "text": text})
    return items


# ---------------------------------------------------------------- main
def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = {"tq": 0, "tq_failed": [], "mhcc_books": 0}

    # 1. Commentary (one big file)
    mhcc = {}
    try:
        raw = fetch(MHCC_URL).decode("utf-8", errors="replace")
        mhcc = parse_mhcc(raw)
        report["mhcc_books"] = len(mhcc)
        print(f"✓ Matthew Henry: {len(mhcc)} books parsed")
    except Exception as e:  # noqa: BLE001
        print(f"✗ Matthew Henry: {e}", file=sys.stderr)

    # 2. Questions per book, then write per-chapter files
    for book, code in BOOKS:
        tq = {}
        try:
            tq = parse_tq(fetch(TQ_URL.format(code=code)).decode("utf-8", errors="replace"))
            report["tq"] += sum(len(v) for v in tq.values())
            print(f"✓ {book}: {sum(len(v) for v in tq.values())} questions")
        except Exception as e:  # noqa: BLE001
            report["tq_failed"].append(book)
            print(f"✗ {book} questions: {e}", file=sys.stderr)
        comm = mhcc.get(book, {})
        chapters = sorted(set(tq) | {c for c in comm if c > 0})
        bdir = OUT / slug(book)
        bdir.mkdir(parents=True, exist_ok=True)
        if comm.get(0):
            (bdir / "intro.json").write_text(json.dumps({"book": book, "intro": comm[0]}, ensure_ascii=False))
        for ch in chapters:
            data = {"book": book, "chapter": ch, "questions": tq.get(ch, []), "commentary": comm.get(ch, [])}
            (bdir / f"{ch}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))

    (OUT / "index.json").write_text(json.dumps({
        "sources": [
            {"id": "tq", "name": "unfoldingWord® translationQuestions", "license": "CC BY-SA 4.0",
             "url": "https://www.unfoldingword.org/tq", "note": "© unfoldingWord. Questions and suggested answers; lightly adapted for display."},
            {"id": "mhcc", "name": "Matthew Henry's Concise Commentary", "license": "Public domain",
             "url": "https://ccel.org/ccel/henry/mhcc", "note": "Via the Christian Classics Ethereal Library."},
        ],
        "report": report,
    }, ensure_ascii=False, indent=1))
    print(f"\nDone. {report}")
    return 0 if (report["tq"] or report["mhcc_books"]) else 1


if __name__ == "__main__":
    sys.exit(main())
