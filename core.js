(function (root, factory) {
  const api = factory();
  root.HisnetCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const BOARD_ORIGIN = "https://hisnet.handong.edu";
  const BOARD_PATH = "/myboard/list.php";
  const BOARD_PRESETS = [
    { category: "일반", name: "일반공지", boardId: "NB0001" },
    { category: "장학공지", name: "장학공지", boardId: "JANG_NOTICE" },
    { category: "일반", name: "진로취업프로그램", boardId: "B0364" },
    { category: "일반", name: "생활관/RC공지", boardId: "RCNOTICE" },
    { category: "일반", name: "연구공지", boardId: "RESEARCH_NOTICE" },
    { category: "일반", name: "OIA Info (국제협력)", boardId: "FOREIGNF_NOTICE" },
    { category: "일반", name: "장애학생지원", boardId: "STU_DISABILITY" },
    { category: "일반", name: "성경읽기", boardId: "BIBLE_READING" },
    { category: "일반", name: "대학혁신지원사업", boardId: "UNIV_INNOVATION" },
    { category: "일반", name: "한동의 지진대응", boardId: "OVERCOME" },
    { category: "일반", name: "한동의 코로나19 대응", boardId: "COVID_19" },
    { category: "일반", name: "각종서식모음", boardId: "B0003" },
    { category: "학부공지", name: "글로벌리더십학부", boardId: "B0020" },
    { category: "학부공지", name: "국제어문학부", boardId: "B0021" },
    { category: "학부공지", name: "경영경제학부", boardId: "B0022" },
    { category: "학부공지", name: "법학부", boardId: "B0023" },
    { category: "학부공지", name: "커뮤니케이션학부", boardId: "B0024" },
    { category: "학부공지", name: "상담심리사회복지학부", boardId: "B0102" },
    { category: "학부공지", name: "생명과학부", boardId: "B0028" },
    { category: "학부공지", name: "공간환경시스템공학부", boardId: "B0025" },
    { category: "학부공지", name: "AI컴퓨터전자공학부", boardId: "B0029" },
    { category: "학부공지", name: "콘텐츠융합디자인학부", boardId: "B0027" },
    { category: "학부공지", name: "기계제어공학부", boardId: "B0026" },
    { category: "학부공지", name: "언어교육원", boardId: "B0031" },
    { category: "학부공지", name: "창의융합교육원", boardId: "B0427" },
    { category: "학부공지", name: "ICT창업학부", boardId: "B0419" },
    { category: "학부공지", name: "AI융합교육원", boardId: "B0431" },
    { category: "학부공지", name: "AI융합학부", boardId: "B0434" },
    { category: "학부공지", name: "신앙교육원", boardId: "B0432" },
    { category: "대학원공지", name: "대학원공지", boardId: "B0113" },
    { category: "대학원공지", name: "대학원양식", boardId: "B0114" },
    { category: "대학원공지", name: "대학원 학과공지", boardId: "B0430" },
  ].map((board) => ({
    category: board.category,
    name: board.name,
    url: `${BOARD_ORIGIN}${BOARD_PATH}?Board=${board.boardId}`,
  }));

  function decodeCodePoint(value, radix) {
    const codePoint = Number.parseInt(value, radix);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return "�";
    }
    return String.fromCodePoint(codePoint);
  }

  function decodeHtmlEntities(text) {
    const namedEntities = {
      "&nbsp;": " ",
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&#39;": "'",
      "&apos;": "'",
    };

    return String(text || "")
      .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (match) => namedEntities[match])
      .replace(/&#(\d+);/g, (_, decimal) => decodeCodePoint(decimal, 10))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => decodeCodePoint(hex, 16));
  }

  function parseBoardPosts(html) {
    const rows = String(html || "").match(/<tr\b[^>]*class=["'][^"']*\btr_basic\b[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi) || [];
    const posts = [];

    for (const row of rows) {
      const links = [...row.matchAll(/<a\b[^>]*href=["'][^"']*read\.php\?[^"']*\bid=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];
      if (links.length === 0) {
        continue;
      }

      const id = Number(links[0][1]);
      const titleLink = [...links].reverse().find((match) => decodeHtmlEntities(match[2].replace(/<[^>]*>/g, "")).trim());
      if (!Number.isSafeInteger(id) || !titleLink) {
        continue;
      }

      const title = decodeHtmlEntities(titleLink[2].replace(/<[^>]*>/g, "")).trim();
      const dateMatch = row.match(/<div\b[^>]*align=["']?center["']?[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/div>/i);
      posts.push({ id, title, date: dateMatch ? dateMatch[1] : "" });
    }

    return posts;
  }

  function validateBoardUrl(value) {
    let parsed;
    try {
      parsed = new URL(String(value || "").trim());
    } catch (_error) {
      return { ok: false, message: "올바른 게시판 URL을 입력해주세요." };
    }

    if (parsed.protocol !== "https:" || parsed.hostname !== "hisnet.handong.edu") {
      return { ok: false, message: "HISNet HTTPS 주소만 추가할 수 있습니다." };
    }
    if (parsed.pathname !== BOARD_PATH) {
      return { ok: false, message: "HISNet 게시판 목록 주소를 입력해주세요." };
    }

    const boardId = (parsed.searchParams.get("Board") || "").trim();
    if (!/^[A-Za-z0-9_]+$/.test(boardId)) {
      return { ok: false, message: "게시판 주소에 유효한 Board 값이 필요합니다." };
    }

    return {
      ok: true,
      url: `${BOARD_ORIGIN}${BOARD_PATH}?Board=${encodeURIComponent(boardId)}`,
      boardId,
    };
  }

  function normalizeBoardUrl(value) {
    const result = validateBoardUrl(value);
    return result.ok ? result.url : null;
  }

  function normalizeBoard(board, presets = BOARD_PRESETS) {
    if (!board || !board.name) {
      return null;
    }
    const url = normalizeBoardUrl(board.url);
    if (!url) {
      return null;
    }
    const preset = presets.find((item) => normalizeBoardUrl(item.url) === url);
    return {
      category: board.category || preset?.category || "기타",
      name: String(board.name).trim(),
      url,
    };
  }

  function normalizeNotice(post, boards = []) {
    const board = boards.find((item) => item.name === post?.boardName);
    return {
      boardName: String(post?.boardName || "기타"),
      category: String(post?.category || board?.category || "기타"),
      title: String(post?.title || ""),
      date: String(post?.date || ""),
      url: String(post?.url || ""),
      read: post?.read === true,
      favorite: post?.favorite === true,
    };
  }

  function mergeNotices(existing, incoming) {
    const byUrl = new Map();
    const order = [];

    for (const post of existing || []) {
      if (!post?.url) continue;
      if (!byUrl.has(post.url)) order.push(post.url);
      byUrl.set(post.url, { ...post });
    }

    for (const post of incoming || []) {
      if (!post?.url) continue;
      const previous = byUrl.get(post.url);
      if (!previous) {
        order.push(post.url);
        byUrl.set(post.url, { ...post });
        continue;
      }
      byUrl.set(post.url, {
        ...previous,
        ...post,
        title: post.title || previous.title,
        date: post.date || previous.date,
        category: post.category || previous.category,
        read: previous.read === true,
        favorite: previous.favorite === true,
      });
    }

    return order.map((url) => byUrl.get(url));
  }

  function markNoticeRead(posts, url) {
    return (posts || []).map((post) => (post.url === url ? { ...post, read: true } : { ...post }));
  }

  function toggleNoticeFavorite(posts, url) {
    return (posts || []).map((post) =>
      post.url === url ? { ...post, favorite: post.favorite !== true } : { ...post }
    );
  }

  function deleteNotice(posts, url) {
    return (posts || []).filter((post) => post.url !== url).map((post) => ({ ...post }));
  }

  function clearReadNotices(posts) {
    return (posts || []).filter((post) => post.read !== true || post.favorite === true).map((post) => ({ ...post }));
  }

  function countUnread(posts) {
    return (posts || []).filter((post) => post.read !== true).length;
  }

  function getNoticeFilters(posts) {
    const boardPrefix = "게시판: ";
    const categoryOrder = ["일반", "장학공지", "학부공지", "대학원공지", "기타"];
    const categories = new Set((posts || []).map((post) => post.category).filter(Boolean));
    const orderedCategories = categoryOrder.filter((category) => categories.has(category));
    const remainingCategories = [...categories].filter((category) => !categoryOrder.includes(category));
    const categorySet = new Set([...orderedCategories, ...remainingCategories]);
    const boardNames = [...new Set((posts || []).map((post) => post.boardName).filter(Boolean))]
      .map((name) => categorySet.has(name) ? `${boardPrefix}${name}` : name);
    return ["전체", "즐겨찾기", ...categorySet, ...boardNames];
  }

  function filterNotices(posts, filter) {
    const boardPrefix = "게시판: ";
    if (!filter || filter === "전체") return [...(posts || [])];
    if (filter === "즐겨찾기") return (posts || []).filter((post) => post.favorite === true);
    if (filter.startsWith(boardPrefix)) {
      const boardName = filter.slice(boardPrefix.length);
      return (posts || []).filter((post) => post.boardName === boardName);
    }
    const categories = new Set((posts || []).map((post) => post.category).filter(Boolean));
    if (categories.has(filter)) return (posts || []).filter((post) => post.category === filter);
    return (posts || []).filter((post) => post.boardName === filter);
  }

  function resolveNoticeFilter(posts, filter) {
    return getNoticeFilters(posts).includes(filter) ? filter : "전체";
  }

  function prepareCustomBoard(nameValue, urlValue, existingBoards) {
    const name = String(nameValue || "").trim();
    if (!name) {
      return { ok: false, message: "게시판 이름을 입력해주세요." };
    }
    const validation = validateBoardUrl(urlValue);
    if (!validation.ok) {
      return validation;
    }
    const duplicate = (existingBoards || []).some(
      (board) => normalizeBoardUrl(board.url) === validation.url
    );
    if (duplicate) {
      return { ok: false, message: "이미 추가된 게시판입니다." };
    }
    return {
      ok: true,
      board: { category: "기타", name, url: validation.url },
    };
  }

  return {
    BOARD_PRESETS,
    decodeHtmlEntities,
    parseBoardPosts,
    normalizeBoardUrl,
    validateBoardUrl,
    normalizeBoard,
    normalizeNotice,
    mergeNotices,
    markNoticeRead,
    toggleNoticeFavorite,
    deleteNotice,
    clearReadNotices,
    countUnread,
    getNoticeFilters,
    filterNotices,
    resolveNoticeFilter,
    prepareCustomBoard,
  };
});
