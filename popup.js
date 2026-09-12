function formatRelativeTime(timestamp) {
  const diffMin = Math.round((Date.now() - timestamp) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  return `${Math.round(diffHour / 24)}일 전`;
}

function renderSubtitle(lastCheckStatus) {
  const el = document.getElementById("subtitle");

  if (!lastCheckStatus) {
    el.textContent = "아직 확인 기록이 없습니다.";
    el.classList.remove("fail");
    return;
  }

  const time = formatRelativeTime(lastCheckStatus.time);
  el.textContent = lastCheckStatus.success ? `${time} 확인 · 정상` : `${time} 확인 · 오류`;
  el.classList.toggle("fail", !lastCheckStatus.success);
}

async function renderFooter() {
  const data = await chrome.storage.local.get("boards");
  const count = (data.boards || []).length;
  document.getElementById("boardCount").textContent = `게시판 ${count}개 감시 중`;
}

async function loadStatus() {
  const data = await chrome.storage.local.get("lastCheckStatus");
  renderSubtitle(data.lastCheckStatus);
}

function renderNewPosts(posts) {
  const list = document.getElementById("newPostsList");
  const emptyState = document.getElementById("emptyState");

  if (!posts || posts.length === 0) {
    list.hidden = true;
    emptyState.hidden = false;
    return;
  }

  list.innerHTML = "";
  posts.forEach((post) => {
    const li = document.createElement("li");

    const bar = document.createElement("div");
    bar.className = "unread-bar";

    const link = document.createElement("a");
    link.href = "#";

    const boardTag = document.createElement("span");
    boardTag.className = "board-tag";
    boardTag.textContent = post.boardName;

    link.appendChild(boardTag);
    link.appendChild(document.createTextNode(post.title));
    link.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: post.url });
    });

    li.appendChild(bar);
    li.appendChild(link);
    list.appendChild(li);
  });

  list.hidden = false;
  emptyState.hidden = true;
}

async function loadAndConsumeNewPosts() {
  const response = await chrome.runtime.sendMessage({ type: "CONSUME_UNREAD_POSTS" });
  renderNewPosts(response?.posts);
}

async function refresh() {
  const btn = document.getElementById("refreshBtn");
  btn.classList.add("spinning");
  btn.disabled = true;

  await chrome.runtime.sendMessage({ type: "RUN_CHECK_NOW" });

  await loadStatus();
  await loadAndConsumeNewPosts();
  await renderFooter();

  btn.classList.remove("spinning");
  btn.disabled = false;
}

document.getElementById("refreshBtn").addEventListener("click", refresh);
document.getElementById("openOptionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

loadStatus();
loadAndConsumeNewPosts();
renderFooter();
