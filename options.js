const DEFAULT_BOARDS = [
  { name: "일반공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=NB0001" },
  { name: "장학공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=JANG_NOTICE" },
  { name: "대학원공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=B0113" },
];

let currentBoards = [];

function renderStatus(lastCheckStatus) {
  const box = document.getElementById("statusBox");

  if (!lastCheckStatus) {
    box.textContent = "아직 확인 기록이 없습니다.";
    box.style.color = "#888";
    return;
  }

  const time = new Date(lastCheckStatus.time).toLocaleString("ko-KR");
  box.textContent = `${lastCheckStatus.success ? "✅ 정상" : "❌ 오류"} · ${time}`;
  box.style.color = lastCheckStatus.success ? "#1a7a1a" : "#b00020";
}

async function loadSettings() {
  const data = await chrome.storage.local.get([
    "credentials",
    "boards",
    "checkIntervalMinutes",
    "lastCheckStatus",
  ]);

  document.getElementById("loginId").value = data.credentials?.id || "";
  document.getElementById("loginPassword").value = data.credentials?.password || "";
  document.getElementById("intervalMinutes").value = data.checkIntervalMinutes || 60;

  currentBoards = data.boards || DEFAULT_BOARDS;
  renderBoardList();
  renderStatus(data.lastCheckStatus);
}

async function testLogin() {
  const id = document.getElementById("loginId").value.trim();
  const password = document.getElementById("loginPassword").value;
  const resultEl = document.getElementById("testLoginResult");

  if (!id || !password) {
    resultEl.textContent = "아이디와 비밀번호를 먼저 입력해주세요.";
    resultEl.style.color = "#b00020";
    return;
  }

  resultEl.textContent = "테스트 중...";
  resultEl.style.color = "#666";

  const result = await chrome.runtime.sendMessage({ type: "TEST_LOGIN", id, password });

  resultEl.textContent = result.success ? "✅ 로그인 성공" : `❌ ${result.message}`;
  resultEl.style.color = result.success ? "#1a7a1a" : "#b00020";
}

function renderBoardList() {
  const list = document.getElementById("boardList");
  list.innerHTML = "";

  currentBoards.forEach((board, index) => {
    const li = document.createElement("li");

    const info = document.createElement("div");
    info.className = "board-info";

    const name = document.createElement("span");
    name.className = "board-name";
    name.textContent = board.name;

    const url = document.createElement("span");
    url.className = "board-url";
    url.textContent = board.url;

    info.appendChild(name);
    info.appendChild(url);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "icon-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", `${board.name} 삭제`);
    deleteBtn.title = "삭제";
    deleteBtn.addEventListener("click", () => {
      currentBoards.splice(index, 1);
      renderBoardList();
    });

    li.appendChild(info);
    li.appendChild(deleteBtn);
    list.appendChild(li);
  });
}

function addBoard() {
  const nameInput = document.getElementById("newBoardName");
  const urlInput = document.getElementById("newBoardUrl");

  const name = nameInput.value.trim();
  const url = urlInput.value.trim();

  if (!name || !url) {
    alert("게시판 이름과 URL을 모두 입력해주세요.");
    return;
  }

  currentBoards.push({ name, url });
  nameInput.value = "";
  urlInput.value = "";
  renderBoardList();
}

async function saveSettings() {
  const id = document.getElementById("loginId").value.trim();
  const password = document.getElementById("loginPassword").value;
  let intervalMinutes = Number(document.getElementById("intervalMinutes").value);

  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 15) {
    intervalMinutes = 15;
    document.getElementById("intervalMinutes").value = 15;
  }

  await chrome.storage.local.set({
    credentials: { id, password },
    boards: currentBoards,
    checkIntervalMinutes: intervalMinutes,
  });

  const statusMsg = document.getElementById("statusMsg");
  statusMsg.textContent = "저장되었습니다.";
  setTimeout(() => {
    statusMsg.textContent = "";
  }, 2000);
}

document.getElementById("addBoardBtn").addEventListener("click", addBoard);
document.getElementById("saveBtn").addEventListener("click", saveSettings);
document.getElementById("testLoginBtn").addEventListener("click", testLogin);

loadSettings();
