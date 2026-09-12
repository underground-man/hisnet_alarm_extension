const DEFAULT_BOARDS = [
  { name: "일반공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=NB0001" },
  { name: "장학공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=JANG_NOTICE" },
  { name: "대학원공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=B0113" },
];

let currentBoards = [];

async function loadSettings() {
  const data = await chrome.storage.local.get(["credentials", "boards", "checkIntervalMinutes"]);

  document.getElementById("loginId").value = data.credentials?.id || "";
  document.getElementById("loginPassword").value = data.credentials?.password || "";
  document.getElementById("intervalMinutes").value = data.checkIntervalMinutes || 60;

  currentBoards = data.boards || DEFAULT_BOARDS;
  renderBoardList();
}

function renderBoardList() {
  const list = document.getElementById("boardList");
  list.innerHTML = "";

  currentBoards.forEach((board, index) => {
    const li = document.createElement("li");

    const label = document.createElement("span");
    label.textContent = `${board.name} (${board.url})`;

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "삭제";
    deleteBtn.addEventListener("click", () => {
      currentBoards.splice(index, 1);
      renderBoardList();
    });

    li.appendChild(label);
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

loadSettings();
