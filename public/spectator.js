const socket = io();
const grid = document.getElementById("grid");

const cells = new Map(); // slot -> {el, name, score, alive}

document.getElementById("watch").onclick = () => {
  const code = document.getElementById("room").value.trim().toUpperCase();
  if (!code) return alert("Enter room code");
  socket.emit("join_as_spectator", { code }, (res) => {
    if (!res.ok) return alert("Cannot watch");
    document.querySelector(".join").style.display = "none";
  });
};

socket.on("roster", ({ capacity, players }) => {
  ensureGrid(capacity);
  // Reset
  for (const [slot, c] of cells) {
    c.el.classList.remove("active");
    c.name.textContent = "— empty —";
    c.score.textContent = "0";
    c.alive.textContent = "";
  }
  // Fill active players
  players.forEach(p => {
    const c = cells.get(p.slot);
    c.el.classList.add("active");
    c.name.textContent = p.name;
    c.score.textContent = String(p.score);
    c.alive.textContent = p.alive ? "🟢" : "🔴";
  });
});

socket.on("spectator_state", ({ slot, score, alive }) => {
  const c = cells.get(slot);
  if (!c) return;
  c.score.textContent = String(score);
  c.alive.textContent = alive ? "🟢" : "🔴";
});

function ensureGrid(capacity) {
  if (cells.size) return; // build once
  grid.innerHTML = "";
  for (let i = 0; i < capacity; i++) {
    const el = document.createElement("div");
    el.className = "cell";
    el.innerHTML = `
      <div class="header">Player ${i+1}</div>
      <div class="name">— empty —</div>
      <div class="stat">Score: <span class="score">0</span></div>
      <div class="stat alive"></div>
    `;
    grid.appendChild(el);
    cells.set(i, {
      el,
      name: el.querySelector(".name"),
      score: el.querySelector(".score"),
      alive: el.querySelector(".alive")
    });
  }
}
