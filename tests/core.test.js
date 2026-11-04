const test = require("node:test");
const assert = require("node:assert/strict");

function loadCore() {
  delete require.cache[require.resolve("../core.js")];
  return require("../core.js");
}

test("parses valid rows and entities", () => {
  const { parseBoardPosts } = loadCore();
  const html = `
    <tr class="tr_basic">
      <td><a href="read.php?id=42&Board=NB0001">42</a></td>
      <td><a href="read.php?id=42&Board=NB0001">장학금 &amp; 등록 안내</a></td>
      <td><div align="center">2026-10-26</div></td>
    </tr>`;

  assert.deepEqual(parseBoardPosts(html), [
    { id: 42, title: "장학금 & 등록 안내", date: "2026-10-26" },
  ]);
});

test("skips a malformed row and keeps later rows", () => {
  const { parseBoardPosts } = loadCore();
  const html = `
    <tr class="tr_basic"><td>링크가 없는 손상 행</td></tr>
    <tr class="tr_basic">
      <td><a href="read.php?id=77&Board=B0029">정상 제목</a></td>
      <td><div align="center">2026-10-25</div></td>
    </tr>`;

  assert.deepEqual(parseBoardPosts(html), [
    { id: 77, title: "정상 제목", date: "2026-10-25" },
  ]);
});

test("invalid numeric entities do not abort later valid rows", () => {
  const { parseBoardPosts } = loadCore();
  const html = `
    <tr class="tr_basic"><td><a href="read.php?id=1&Board=NB0001">손상 &#99999999; &#xFFFFFFF;</a></td></tr>
    <tr class="tr_basic"><td><a href="read.php?id=2&Board=NB0001">정상 공지</a></td></tr>`;
  assert.deepEqual(parseBoardPosts(html).map((post) => post.title), ["손상 � �", "정상 공지"]);
});

test("returns an empty array when no rows exist", () => {
  const { parseBoardPosts } = loadCore();
  assert.deepEqual(parseBoardPosts("<html><body>empty</body></html>"), []);
});

test("accepts and normalizes a HISNet board URL", () => {
  const { validateBoardUrl } = loadCore();
  assert.deepEqual(
    validateBoardUrl(" https://hisnet.handong.edu/myboard/list.php?Page=2&Board=NB0001 "),
    {
      ok: true,
      url: "https://hisnet.handong.edu/myboard/list.php?Board=NB0001",
      boardId: "NB0001",
    }
  );
});

test("rejects another host", () => {
  const { validateBoardUrl } = loadCore();
  assert.equal(validateBoardUrl("https://example.com/myboard/list.php?Board=NB0001").ok, false);
});

test("rejects non-https URLs", () => {
  const { validateBoardUrl } = loadCore();
  assert.equal(validateBoardUrl("http://hisnet.handong.edu/myboard/list.php?Board=NB0001").ok, false);
});

test("rejects a different path", () => {
  const { validateBoardUrl } = loadCore();
  assert.equal(validateBoardUrl("https://hisnet.handong.edu/login/login.php?Board=NB0001").ok, false);
});

test("rejects a missing Board value", () => {
  const { validateBoardUrl } = loadCore();
  assert.equal(validateBoardUrl("https://hisnet.handong.edu/myboard/list.php").ok, false);
});

const KNOWN_BOARDS = [
  {
    category: "장학공지",
    name: "장학공지",
    url: "https://hisnet.handong.edu/myboard/list.php?Board=JANG_NOTICE",
  },
  {
    category: "학부공지",
    name: "AI컴퓨터전자공학부",
    url: "https://hisnet.handong.edu/myboard/list.php?Board=B0029",
  },
];

test("normalizes legacy boards with known and custom categories", () => {
  const { normalizeBoard } = loadCore();
  assert.deepEqual(
    normalizeBoard({ name: "장학공지", url: KNOWN_BOARDS[0].url }, KNOWN_BOARDS),
    KNOWN_BOARDS[0]
  );
  assert.deepEqual(
    normalizeBoard(
      { name: "동아리공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=CLUB" },
      KNOWN_BOARDS
    ),
    {
      category: "기타",
      name: "동아리공지",
      url: "https://hisnet.handong.edu/myboard/list.php?Board=CLUB",
    }
  );
});

test("normalizes legacy notices as unread and unfavorited", () => {
  const { normalizeNotice } = loadCore();
  assert.deepEqual(
    normalizeNotice(
      {
        boardName: "장학공지",
        title: "신청 안내",
        date: "2026-10-26",
        url: "https://hisnet.handong.edu/myboard/read.php?id=9&Page=1&Board=JANG_NOTICE",
      },
      KNOWN_BOARDS
    ),
    {
      boardName: "장학공지",
      category: "장학공지",
      title: "신청 안내",
      date: "2026-10-26",
      url: "https://hisnet.handong.edu/myboard/read.php?id=9&Page=1&Board=JANG_NOTICE",
      read: false,
      favorite: false,
    }
  );
});

test("merges duplicate notices while preserving user state", () => {
  const { mergeNotices } = loadCore();
  const url = "https://hisnet.handong.edu/myboard/read.php?id=9&Page=1&Board=JANG_NOTICE";
  const existing = [{ boardName: "장학공지", category: "장학공지", title: "옛 제목", date: "", url, read: true, favorite: true }];
  const incoming = [{ boardName: "장학공지", category: "장학공지", title: "새 제목", date: "2026-10-26", url, read: false, favorite: false }];

  assert.deepEqual(mergeNotices(existing, incoming), [
    { boardName: "장학공지", category: "장학공지", title: "새 제목", date: "2026-10-26", url, read: true, favorite: true },
  ]);
});

function sampleNotices() {
  return [
    { boardName: "장학공지", category: "장학공지", title: "장학", date: "", url: "u1", read: false, favorite: false },
    { boardName: "AI컴퓨터전자공학부", category: "학부공지", title: "학부", date: "", url: "u2", read: true, favorite: true },
    { boardName: "대학원공지", category: "대학원공지", title: "대학원", date: "", url: "u3", read: true, favorite: false },
  ];
}

test("marks only the selected notice as read", () => {
  const { markNoticeRead } = loadCore();
  assert.deepEqual(markNoticeRead(sampleNotices(), "u1").map((post) => post.read), [true, true, true]);
  assert.equal(sampleNotices()[0].read, false);
});

test("toggles a favorite without mutating input", () => {
  const { toggleNoticeFavorite } = loadCore();
  const original = sampleNotices();
  const once = toggleNoticeFavorite(original, "u1");
  const twice = toggleNoticeFavorite(once, "u1");
  assert.equal(original[0].favorite, false);
  assert.equal(once[0].favorite, true);
  assert.equal(twice[0].favorite, false);
});

test("deletes only the selected notice regardless of read or favorite state", () => {
  const { deleteNotice } = loadCore();
  const original = sampleNotices();
  const remaining = deleteNotice(original, "u2");

  assert.deepEqual(remaining.map((post) => post.url), ["u1", "u3"]);
  assert.deepEqual(original.map((post) => post.url), ["u1", "u2", "u3"]);
});

test("clears only read non-favorites", () => {
  const { clearReadNotices } = loadCore();
  assert.deepEqual(clearReadNotices(sampleNotices()).map((post) => post.url), ["u1", "u2"]);
});

test("counts only unread notices", () => {
  const { countUnread } = loadCore();
  assert.equal(countUnread(sampleNotices()), 1);
});

test("generates and applies favorite category and board filters", () => {
  const { filterNotices, getNoticeFilters } = loadCore();
  const posts = sampleNotices();
  assert.deepEqual(getNoticeFilters(posts), [
    "전체",
    "즐겨찾기",
    "장학공지",
    "학부공지",
    "대학원공지",
    "게시판: 장학공지",
    "AI컴퓨터전자공학부",
    "게시판: 대학원공지",
  ]);
  assert.deepEqual(filterNotices(posts, "즐겨찾기").map((post) => post.url), ["u2"]);
  assert.deepEqual(filterNotices(posts, "학부공지").map((post) => post.url), ["u2"]);
  assert.deepEqual(filterNotices(posts, "게시판: 장학공지").map((post) => post.url), ["u1"]);
  assert.deepEqual(filterNotices(posts, "AI컴퓨터전자공학부").map((post) => post.url), ["u2"]);
});

test("falls back to all notices when a removed board filter no longer exists", () => {
  const { resolveNoticeFilter } = loadCore();
  const remaining = sampleNotices().filter((post) => post.boardName !== "AI컴퓨터전자공학부");
  assert.equal(resolveNoticeFilter(remaining, "AI컴퓨터전자공학부"), "전체");
});

test("keeps category and same-named board filters distinct", () => {
  const { filterNotices, getNoticeFilters } = loadCore();
  const posts = [
    { boardName: "대학원공지", category: "대학원공지", title: "공지", url: "g1" },
    { boardName: "대학원양식", category: "대학원공지", title: "양식", url: "g2" },
  ];

  assert.deepEqual(getNoticeFilters(posts), [
    "전체",
    "즐겨찾기",
    "대학원공지",
    "게시판: 대학원공지",
    "대학원양식",
  ]);
  assert.deepEqual(filterNotices(posts, "대학원공지").map((post) => post.url), ["g1", "g2"]);
  assert.deepEqual(filterNotices(posts, "게시판: 대학원공지").map((post) => post.url), ["g1"]);
  assert.deepEqual(filterNotices(posts, "대학원양식").map((post) => post.url), ["g2"]);
});
