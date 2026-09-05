// ---------------------------------------------------------------------------
// Editable content: verses, ACTS prompts, gospel-lens questions.
// Scripture quotations are from the World English Bible (public domain).
// ---------------------------------------------------------------------------
window.CONTENT = {
  verses: [
    { ref: "Psalm 46:10", text: "Be still, and know that I am God." },
    { ref: "Lamentations 3:22–23", text: "It is because of Yahweh’s loving kindnesses that we are not consumed, because his compassion doesn’t fail. They are new every morning. Great is your faithfulness." },
    { ref: "Philippians 4:6", text: "In nothing be anxious, but in everything, by prayer and petition with thanksgiving, let your requests be made known to God." },
    { ref: "John 15:5", text: "I am the vine. You are the branches. He who remains in me and I in him bears much fruit, for apart from me you can do nothing." },
    { ref: "Psalm 119:105", text: "Your word is a lamp to my feet, and a light for my path." },
    { ref: "Matthew 11:28", text: "Come to me, all you who labor and are heavily burdened, and I will give you rest." },
    { ref: "James 4:8", text: "Draw near to God, and he will draw near to you." },
    { ref: "Romans 5:8", text: "But God commends his own love toward us, in that while we were yet sinners, Christ died for us." },
    { ref: "1 John 1:9", text: "If we confess our sins, he is faithful and righteous to forgive us the sins, and to cleanse us from all unrighteousness." },
    { ref: "Psalm 27:4", text: "One thing I have asked of Yahweh, that I will seek after: that I may dwell in Yahweh’s house all the days of my life, to see Yahweh’s beauty, and to inquire in his temple." },
    { ref: "Isaiah 41:10", text: "Don’t you be afraid, for I am with you. Don’t be dismayed, for I am your God. I will strengthen you. Yes, I will help you." },
    { ref: "2 Corinthians 5:17", text: "Therefore if anyone is in Christ, he is a new creation. The old things have passed away. Behold, all things have become new." },
    { ref: "Hebrews 4:16", text: "Let’s therefore draw near with boldness to the throne of grace, that we may receive mercy and may find grace for help in time of need." },
    { ref: "Psalm 1:2", text: "His delight is in Yahweh’s law. On his law he meditates day and night." },
  ],

  // Gospel-lens questions for reflecting on a devotional / passage.
  lens: [
    { key: "god", label: "What does this show me about God?", hint: "His character, promises, purposes." },
    { key: "us", label: "What does this show me about people — about me?", hint: "Our need, sin, fear, or longing." },
    { key: "christ", label: "Where is Jesus and the gospel in this?", hint: "How does what Christ has done meet the need here?" },
    { key: "response", label: "If I truly believed this today, what would change?", hint: "One concrete response — not a resolution, a response to grace." },
  ],

  acts: {
    A: {
      name: "Adoration",
      tagline: "Praise God for who he is, before anything he gives.",
      verse: { ref: "Psalm 145:3", text: "Great is Yahweh, and greatly to be praised! His greatness is unsearchable." },
      prompts: [
        "Which attribute of God has been most real to you this week — his patience, power, faithfulness, nearness? Praise him for it.",
        "Take one line from today’s reading and turn it into praise: “Lord, you are…”",
        "Praise God the Father for adopting you, the Son for redeeming you, the Spirit for indwelling you.",
        "What has God made or done that fills you with wonder? Tell him.",
        "Name three things that are true of God even when your day goes badly.",
        "Praise Jesus for a specific way he showed the Father’s heart in the Gospels.",
      ],
      placeholder: "Lord, you are…",
      saveLabel: "Keep this praise",
    },
    C: {
      name: "Confession",
      tagline: "Bring what’s real to a God who already knows and still welcomes you.",
      verse: { ref: "Psalm 51:17", text: "The sacrifices of God are a broken spirit. O God, you will not despise a broken and contrite heart." },
      prompts: [
        "Where did I try to be my own saviour today — controlling, proving, hiding?",
        "What am I currently trusting for peace or worth other than Christ?",
        "Is there anyone I need to forgive, or ask forgiveness from?",
        "What did I leave undone that love would have done?",
        "Name the sin plainly, then name the gospel plainly: “…and Christ died for exactly this.”",
        "Where have I been anxious rather than prayerful? Hand it over.",
      ],
      placeholder: "Father, I confess…",
      saveLabel: "Keep as a point to keep bringing",
    },
    T: {
      name: "Thanksgiving",
      tagline: "Notice grace. Gratitude is how faith sees clearly.",
      verse: { ref: "1 Thessalonians 5:18", text: "In everything give thanks, for this is the will of God in Christ Jesus toward you." },
      prompts: [
        "Three specific gifts from the last 24 hours — small counts.",
        "A prayer that has been answered recently, in full or in part.",
        "Someone God has placed in your life — family, church, a colleague, a friend. Thank him for them by name.",
        "Thank God for a hard thing he has used, or is using, for good.",
        "Thank Jesus for the cross — say what it actually means for you today.",
        "Thank God for your church, your Bible study group, and the people who teach you.",
      ],
      placeholder: "Thank you for…",
      saveLabel: "Keep this thanksgiving",
    },
    S: {
      name: "Supplication",
      tagline: "Ask boldly — for others first, then yourself.",
      verse: { ref: "Philippians 4:6–7", text: "In everything, by prayer and petition with thanksgiving, let your requests be made known to God. And the peace of God… will guard your hearts and your thoughts in Christ Jesus." },
      prompts: [
        "Pray for the people closest to you by name — that Christ would be at the centre of those relationships.",
        "Pray for someone in your Bible study group by name.",
        "Pray for your church and pastors this Sunday.",
        "Pray for one colleague or friend who doesn’t yet know Jesus.",
        "Pray for your work — integrity, diligence, and witness.",
        "Pray for your own growth: hunger for the Word, a softer heart, a steadier prayer life.",
        "What are you worried about? Turn each worry into a request.",
      ],
      placeholder: "Please…",
      saveLabel: "Add as a prayer point",
    },
  },

  // Bible books and chapter counts (for reading plans).
  books: [
    ["Genesis",50],["Exodus",40],["Leviticus",27],["Numbers",36],["Deuteronomy",34],["Joshua",24],["Judges",21],["Ruth",4],
    ["1 Samuel",31],["2 Samuel",24],["1 Kings",22],["2 Kings",25],["1 Chronicles",29],["2 Chronicles",36],["Ezra",10],["Nehemiah",13],
    ["Esther",10],["Job",42],["Psalms",150],["Proverbs",31],["Ecclesiastes",12],["Song of Songs",8],["Isaiah",66],["Jeremiah",52],
    ["Lamentations",5],["Ezekiel",48],["Daniel",12],["Hosea",14],["Joel",3],["Amos",9],["Obadiah",1],["Jonah",4],["Micah",7],
    ["Nahum",3],["Habakkuk",3],["Zephaniah",3],["Haggai",2],["Zechariah",14],["Malachi",4],
    ["Matthew",28],["Mark",16],["Luke",24],["John",21],["Acts",28],["Romans",16],["1 Corinthians",16],["2 Corinthians",13],
    ["Galatians",6],["Ephesians",6],["Philippians",4],["Colossians",4],["1 Thessalonians",5],["2 Thessalonians",3],["1 Timothy",6],
    ["2 Timothy",4],["Titus",3],["Philemon",1],["Hebrews",13],["James",5],["1 Peter",5],["2 Peter",3],["1 John",5],["2 John",1],
    ["3 John",1],["Jude",1],["Revelation",22],
  ],

  // Starter reading plans. Sequential: today's reading is the next one you haven't done.
  plans: [
    { id: "gospels", name: "The four Gospels", desc: "Matthew → John, one chapter a day. 89 days of watching Jesus.", books: ["Matthew", "Mark", "Luke", "John"], perDay: 1 },
    { id: "psalms", name: "A Psalm a day", desc: "150 days of learning to pray from the prayer book Jesus prayed.", books: ["Psalms"], perDay: 1 },
  ],

  translations: [["ESV", "English Standard Version"], ["NIV", "New International Version"], ["CSB", "Christian Standard Bible"], ["NLT", "New Living Translation"], ["NASB", "New American Standard"], ["NKJV", "New King James"]],

  // Default prayer groups and the weekday each is the focus (0 = Sunday … 6 = Saturday).
  defaultGroups: [
    { id: "family", name: "Family & loved ones", days: [1] },
    { id: "church", name: "Church & Bible study group", days: [2] },
    { id: "friends", name: "Friends", days: [3] },
    { id: "work", name: "Work & colleagues", days: [4] },
    { id: "seeking", name: "Not yet believing", days: [5] },
    { id: "me", name: "Myself", days: [6] },
  ],

  recapTypes: [
    { id: "sermon", label: "Sunday sermon" },
    { id: "study", label: "Bible study group" },
    { id: "other", label: "Other" },
  ],

  recapQuestions: [
    { key: "main", label: "Main point in one sentence", hint: "If someone asked what it was about, what would you say?" },
    { key: "gospel", label: "How did it point to Jesus?", hint: "Where was the gospel — not just the moral?" },
    { key: "struck", label: "What struck me / what I want to remember", hint: "A phrase, a verse, a picture, a question." },
    { key: "apply", label: "One thing I will do or believe differently", hint: "Small and specific." },
    { key: "pray", label: "Something to pray about from this", hint: "Turn it into a prayer point (optional)." },
  ],
};
