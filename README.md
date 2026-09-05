# Abide — daily walk

A small, installable web app (PWA) for reading with a gospel lens, praying through ACTS, keeping prayer points, and recapping sermons and Bible study. Plain HTML/CSS/JS — no build step — hosted on GitHub Pages, with devotional links refreshed every morning by a GitHub Action.

```
index.html          app shell + bottom tabs
app.js              all app logic (routing, storage, Firebase sync)
content.js          verses, ACTS prompts, gospel-lens questions — edit freely
style.css           styles (light + dark)
firebase-config.js  paste your Firebase config here (optional)
data/feed.json      latest devotional links, written daily by the Action
scripts/fetch_feeds.py         pulls the RSS feeds → data/feed.json
scripts/fetch_bible.py         downloads the WEB Bible → data/bible/web/… (one time)
scripts/fetch_study.py         study questions + commentary → data/study/… (one time)
.github/workflows/study.yml    runs fetch_study.py once (or on demand)
.github/workflows/bible.yml    runs fetch_bible.py once (or on demand)
.github/workflows/feeds.yml    runs the script every day at 05:30 SGT
manifest.json, sw.js, icon*.   PWA install + offline
```

## 1. Put it on GitHub Pages

1. Create a new repo (e.g. `abide`), then from this folder:
   ```bash
   git init
   git add .
   git commit -m "Abide: initial"
   git branch -M main
   git remote add origin https://github.com/<you>/abide.git
   git push -u origin main
   ```
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* → `main` / `/ (root)` → Save.
3. Repo → **Settings → Actions → General → Workflow permissions** → choose **Read and write permissions** → Save. (The feed bot needs this to commit `data/feed.json`.)
4. Repo → **Actions** → *Refresh devotional feeds* → **Run workflow** once. After that it runs itself every morning.
5. Open `https://<you>.github.io/abide/` on your phone → Share → *Add to Home Screen*.

Without Firebase, everything is stored in the browser on that device (it still works offline). Use *Settings → Export JSON* for backups.

## 2. Sync across devices with Firebase (optional, ~10 min)

1. [console.firebase.google.com](https://console.firebase.google.com) → Add project (Analytics off is fine).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable** (pick a support email).
   Then **Authentication → Settings → Authorized domains → Add** `<you>.github.io`.
3. **Build → Firestore Database → Create database** → production mode → a region near you (asia-southeast1).
4. **Firestore → Rules** → replace with the rules below → Publish.
5. **Project settings (gear) → Your apps → Web (</>)** → register the app → copy the `firebaseConfig` object.
6. Paste it into `firebase-config.js` as `window.FIREBASE_CONFIG = { … }`, commit, push.
7. On the site: **Settings → Sign in with Google**. Anything already on that device is uploaded on first sign-in.

Firestore rules (each user can only read/write their own data):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Data layout: `users/{uid}/prayers/{id}`, `users/{uid}/recaps/{id}`, `users/{uid}/days/{YYYY-MM-DD}`, and `users/{uid}` holds `settings`. Firestore's offline persistence is enabled, so the app keeps working on the MRT and syncs when back online.

## 3. Devotional sources

Edit the `SOURCES` list at the top of `scripts/fetch_feeds.py` to add or remove feeds — any RSS or Atom feed works (podcasts included). Currently:

| Source | Feed |
|---|---|
| Solid Joys — John Piper | https://feed.desiringgod.org/solid-joys-audio.rss |
| Ask Pastor John — John Piper | https://feed.desiringgod.org/ask-pastor-john.rss |
| Gospel in Life — Tim Keller | https://podcast.gospelinlife.com/feed.xml |
| In Touch Daily Devotions — Charles Stanley | Omny podcast feed (see script) |
| Truth For Life daily program — Alistair Begg | https://feeds.feedburner.com/TruthForLife |
| Morning & Evening — Spurgeon (Truth For Life) | https://feeds.feedburner.com/TruthForLifeDailyDevotional |

To test locally: `python3 scripts/fetch_feeds.py` then `python3 -m http.server` and open http://localhost:8000. If a feed fails one morning the script keeps the previous day's items for that source and marks it with ⚠ on the Read page.

The workflow time is set in `.github/workflows/feeds.yml` (`30 21 * * *` UTC = 05:30 Singapore).

## 4. What's in v2

- **Bible reading plan** (Bible tab). Starter plans: the four Gospels (89 days) and a Psalm a day (150), or a custom plan from any book or run of books at 1–3 chapters a day. Plans are *sequential*: today's reading is simply the next one you haven't marked read, so a missed day never becomes a backlog. Passages open on BibleGateway in your chosen translation (default ESV; change it in Settings or the plan picker). After "I've read it", the same gospel-lens questions appear and the response can become a prayer point.
- **Prayer groups with a weekly rotation.** Supplication points can belong to a group (Family, Church & Bible study group, Friends, Work, Not yet believing, Myself — edit or add your own in Settings). Each group has focus days; on that day its points appear first in the Supplication step and on the home page. Sunday is deliberately left free. Ungrouped points still show under "Everyone else".
- **Answered-prayer wall** (`#answered`, or tap the "answered" stat on the home page). When you mark a point answered you can write one line about how God answered; the wall shows each answered prayer with how long and how many times you prayed for it, and the journey notes.
- **Quiet prayer timer** (button at the top of the Pray page, or the link under "Today's prayer focus"). Full-screen, 3/5/10/15 minutes (default 5), one prompt, a countdown ring, keeps the screen awake, ends with a soft three-note chime and a vibration. Finishing marks that ACTS step done and logs the minutes in your journal.

## 5. Bible text inside the app (v3)

Chapters now display inline on the Bible tab and in a free reader (`#read/<Book>/<chapter>`, or the Browse box). Tap any verse to **save it** (♥, listed under Saved verses), turn it into a prayer point, or copy it. **A− / A+** sets the text size per device.

**One-time setup:** the text comes from the public-domain *World English Bible* and lives in your repo under `data/bible/web/`. After pushing v3, GitHub → **Actions** → *Fetch Bible text (WEB)* → **Run workflow** (it also triggers itself the first time `scripts/fetch_bible.py` is pushed). It downloads ~5 MB of JSON and commits it; a minute later the reader works. Until then the reader shows a pointer to that workflow plus a BibleGateway link.

**ESV instead (optional):** copyrighted translations can't be stored in the repo, but Crossway offers a free personal API. Create a key at [api.esv.org](https://api.esv.org) (non-commercial, 5,000 requests/day), paste it in **Settings → Bible text in the app → ESV API key**, Save. The app then fetches ESV chapters live and falls back to WEB when offline or if the request fails. The key is stored in your app settings (synced through your own Firestore), never committed to the repo. The reader shows Crossway's attribution line when ESV is displayed, as their terms require.

**Offline:** chapters you've opened are cached automatically. **Settings → Download whole Bible for offline** fetches all 1,189 WEB chapters once so the entire Bible reads offline.

## 6. Study material and podcast player (v4)

**Study panel.** Under any chapter, *Study this chapter* opens three tabs: **Questions** (comprehension questions with suggested answers for every chapter, from unfoldingWord® translationQuestions, CC BY-SA 4.0 — write your answer, compare, and it's saved and synced), **Commentary** (Matthew Henry's Concise Commentary, public domain), and **Book** (Matthew Henry's introduction plus your own guide links). **📚 Study** on the Bible tab lists all 66 books; each book page shows its intro, a chapter grid (green = answers saved), and your guide links. A recap whose passage is e.g. "Luke 15" gets an *open ↗* link into the reader.

**One-time setup:** GitHub → **Actions** → *Fetch study material* → **Run workflow** (also runs itself when `scripts/fetch_study.py` is first pushed). It writes `data/study/<book>/<chapter>.json` (~8 MB) and commits.

**Your own guides.** Copyrighted guides (TGC, Crossway, church notes, PDFs) can't be copied into the repo, so each book has a place to paste links; anything from YouTube plays inline, so paste the BibleProject overview for the book (there's a *Find the BibleProject overview* link). Links are stored in your synced settings.

**Podcast player.** On the Devotional page, ▶ next to an episode plays it in a mini-bar above the tabs that keeps playing while you read, pray or write. Play/pause, seek, 1×/1.25×/1.5×/2× speed, lock-screen controls (Media Session) and resume-where-you-left-off. Playing an episode also makes it today's devotional pick. Tapping the title still opens the source page.

## 7. Making it yours

- **Plans, groups, prompts and verses** live in `content.js` (`plans`, `defaultGroups`, `acts`, `verses`, `lens`) — add your own ACTS prompts, change the gospel-lens questions, add verses (the app rotates one per day).
- **Greeting name** is in `routes.home` in `app.js`.
- **Colours** are CSS variables at the top of `style.css`; dark mode follows the system setting.
- If you change `sw.js` cached files, bump `VERSION` in `sw.js` so phones pick up the new build.
