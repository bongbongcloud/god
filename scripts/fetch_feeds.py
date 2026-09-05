#!/usr/bin/env python3
"""
Pulls the latest entries from each devotional/podcast feed and writes them to
data/feed.json, which the site reads. Runs daily via .github/workflows/feeds.yml.

Standard library only — no pip installs needed.
"""
import json
import re
import sys
import html
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Sources. Add/remove entries here — the site picks them up automatically.
#   id      : short key (also used as a CSS class)
#   name    : label shown on the site
#   speaker : who it is
#   kind    : "read" (text devotional) or "listen" (podcast/audio)
#   url     : RSS/Atom feed
#   limit   : how many recent items to keep
# ---------------------------------------------------------------------------
SOURCES = [
    {
        "id": "solid-joys",
        "name": "Solid Joys",
        "speaker": "John Piper · Desiring God",
        "kind": "read",
        "url": "https://feed.desiringgod.org/solid-joys-audio.rss",
        "limit": 7,
    },
    {
        "id": "ask-pastor-john",
        "name": "Ask Pastor John",
        "speaker": "John Piper · Desiring God",
        "kind": "listen",
        "url": "https://feed.desiringgod.org/ask-pastor-john.rss",
        "limit": 6,
    },
    {
        "id": "gospel-in-life",
        "name": "Gospel in Life",
        "speaker": "Tim Keller",
        "kind": "listen",
        "url": "https://podcast.gospelinlife.com/feed.xml",
        "limit": 6,
    },
    {
        "id": "in-touch",
        "name": "In Touch Daily Devotions",
        "speaker": "Charles Stanley · In Touch Ministries",
        "kind": "listen",
        "url": "https://www.omnycontent.com/d/playlist/7237c071-cd56-4495-998a-b23d00f69e8d/87d53d0c-9dc6-4151-b94e-b26701575b7f/20bba2fb-121b-493a-b694-b26701575b98/podcast.rss",
        "limit": 7,
    },
    {
        "id": "truth-for-life",
        "name": "Truth For Life",
        "speaker": "Alistair Begg · Daily Program",
        "kind": "listen",
        "url": "https://feeds.feedburner.com/TruthForLife",
        "limit": 6,
    },
    {
        "id": "truth-for-life-devotional",
        "name": "Morning & Evening",
        "speaker": "Spurgeon · Truth For Life daily devotional",
        "kind": "read",
        "url": "https://feeds.feedburner.com/TruthForLifeDailyDevotional",
        "limit": 7,
    },
]

OUT = Path(__file__).resolve().parent.parent / "data" / "feed.json"
UA = "Mozilla/5.0 (compatible; FaithPlannerFeedBot/1.0; +https://github.com)"

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "media": "http://search.yahoo.com/mrss/",
}


def fetch(url, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (attempt + 1))
    raise last


def strip_html(s, max_len=320):
    if not s:
        return ""
    s = re.sub(r"<br\s*/?>|</p>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > max_len:
        s = s[: max_len - 1].rsplit(" ", 1)[0] + "…"
    return s


def parse_date(s):
    if not s:
        return None
    try:
        return parsedate_to_datetime(s)
    except Exception:  # noqa: BLE001
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            d = datetime.strptime(s.strip(), fmt)
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def text(el, path, ns=None):
    node = el.find(path, ns or {})
    return (node.text or "").strip() if node is not None and node.text else ""


def parse_rss(root, limit):
    items = []
    for it in root.iter("item"):
        title = text(it, "title")
        link = text(it, "link")
        enclosure = it.find("enclosure")
        audio = enclosure.get("url") if enclosure is not None else ""
        if not link and audio:
            link = audio
        desc = (
            text(it, "itunes:summary", NS)
            or text(it, "description")
            or text(it, "content:encoded", NS)
        )
        dur = text(it, "itunes:duration", NS)
        d = parse_date(text(it, "pubDate")) or parse_date(text(it, "dc:date"))
        items.append(
            {
                "title": html.unescape(title),
                "link": link,
                "audio": audio,
                "summary": strip_html(desc),
                "duration": dur,
                "date": d.astimezone(timezone.utc).isoformat() if d else None,
            }
        )
        if len(items) >= limit:
            break
    return items


def parse_atom(root, limit):
    items = []
    for e in root.findall("atom:entry", NS):
        title = text(e, "atom:title", NS)
        link = ""
        audio = ""
        for l in e.findall("atom:link", NS):
            rel = l.get("rel", "alternate")
            if rel == "enclosure":
                audio = l.get("href", "")
            elif rel == "alternate" and not link:
                link = l.get("href", "")
        desc = text(e, "atom:summary", NS) or text(e, "atom:content", NS)
        d = parse_date(text(e, "atom:published", NS)) or parse_date(text(e, "atom:updated", NS))
        items.append(
            {
                "title": html.unescape(title),
                "link": link or audio,
                "audio": audio,
                "summary": strip_html(desc),
                "duration": "",
                "date": d.astimezone(timezone.utc).isoformat() if d else None,
            }
        )
        if len(items) >= limit:
            break
    return items


def parse_feed(raw, limit):
    root = ET.fromstring(raw)
    if root.tag.endswith("feed"):
        return parse_atom(root, limit)
    return parse_rss(root, limit)


def main():
    previous = {}
    if OUT.exists():
        try:
            for s in json.loads(OUT.read_text())["sources"]:
                previous[s["id"]] = s
        except Exception:  # noqa: BLE001
            pass

    out_sources = []
    failures = 0
    for src in SOURCES:
        entry = {k: src[k] for k in ("id", "name", "speaker", "kind")}
        try:
            raw = fetch(src["url"])
            items = parse_feed(raw, src["limit"])
            if not items:
                raise ValueError("feed parsed but contained no items")
            entry["items"] = items
            entry["fetched"] = datetime.now(timezone.utc).isoformat()
            entry["error"] = None
            print(f"✓ {src['name']}: {len(items)} items — latest: {items[0]['title']!r}")
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"✗ {src['name']}: {e}", file=sys.stderr)
            # keep the last good copy so the site never goes blank
            old = previous.get(src["id"], {})
            entry["items"] = old.get("items", [])
            entry["fetched"] = old.get("fetched")
            entry["error"] = str(e)
        out_sources.append(entry)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {"generated": datetime.now(timezone.utc).isoformat(), "sources": out_sources},
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"\nWrote {OUT} ({len(out_sources)} sources, {failures} failed)")
    # Only fail the job if *every* feed failed (network outage), otherwise commit what we have.
    return 1 if failures == len(SOURCES) else 0


if __name__ == "__main__":
    sys.exit(main())
