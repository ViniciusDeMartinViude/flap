const socket = io();

let joined = false;
document.getElementById("join").onclick = () => {
  const code = document.getElementById("room").value.trim().toUpperCase();
  const name = document.getElementById("name").value.trim();
  if (!code) return alert("Enter room code");
  socket.emit("join_as_player", { code, name }, (res) => {
    if (!res.ok) return alert(res.error || "Unable to join");
    document.querySelector(".join").style.display = "none";
    startGame();
  });
};

function startGame() {
  const W = 360, H = 640;
  let deathText;
  let restarting = false;
  const config = {
    type: Phaser.AUTO,
    width: W,
    height: H,
    parent: "game",
    physics: { default: "arcade", arcade: { gravity: { y: 750 } } },
    scene: { preload, create, update }
  };
  new Phaser.Game(config);

  let bird, pipes, score = 0, alive = true, lastSend = 0, bg, scoreText;

  function preload() {
    this.load.image("bg", "background.png");   // background
    this.load.image("bird", "carpet.png");     // placeholder
    this.load.image("pipe", "minarete.png");   // placeholder
  }

  function create() {
    // background
    bg = this.add.image(W / 2, H / 2, "bg");
    bg.setDisplaySize(W, H);

    // bird + pipes
    bird = this.physics.add.sprite(80, H / 2, "bird").setScale(0.5);
    pipes = this.physics.add.group();

    // ✅ SCORE TEXT (top-left)
    scoreText = this.add.text(10, 10, "Score: 0", {
      fontFamily: "Arial",
      fontSize: "24px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 4
    });

    this.input.on("pointerdown", () => {
    if (!alive) return;        // 🆕 ignore taps while dead / waiting
      bird.setVelocityY(-280);
    });

    this.time.addEvent({
      delay: 1400,
      loop: true,
      callback: () => spawnPipes(this)
    });

    this.physics.add.overlap(bird, pipes, () => die(this));

    // death message (hidden initially)
    deathText = this.add.text(W/2, H/2, "Game Over!", {
      fontFamily: "Arial",
      fontSize: "40px",
      color: "#ff3333",
      stroke: "#000",
      strokeThickness: 6
    }).setOrigin(0.5).setVisible(false);

  }

  function update(time) {
    if (!alive) return;
    if (bird.y > H || bird.y < 0) return die(this);

    // Throttle telemetry to ~15Hz
    if (time - lastSend > 66) {
      socket.emit("player_state", { score, alive: true });
      lastSend = time;
    }
  }

  function spawnPipes(scene) {
    if (!alive) return;
    const gap = 150;
    const center = 150 + Math.random() * (H - 300);
    const topY = center - gap / 2 - 320,
      botY = center + gap / 2;

    const top = pipes
      .create(W + 40, topY, "pipe")
      .setImmovable(true)
      .setVelocityX(-160);
    const bot = pipes
      .create(W + 40, botY, "pipe")
      .setImmovable(true)
      .setVelocityX(-160)
      .setFlipY(true);

    top.body.allowGravity = bot.body.allowGravity = false;

    // invisible scorer zone
    const scorer = scene.add.zone(W + 40, center, 10, gap);
    scene.physics.world.enable(scorer);
    scorer.body.setVelocityX(-160);
    scorer.body.allowGravity = false;

    scene.physics.add.overlap(bird, scorer, () => {
      // ✅ update score + text
      score++;
      scoreText.setText("Score: " + score);
      scorer.destroy();
    });
  }

  function die(scene) {
  if (!alive || restarting) return; // 🆕 don't schedule twice
  alive = false;
  restarting = true;

  // notify server
  socket.emit("player_state", { score, alive: false });

  // show message
  deathText.setText("Game Over!");
  deathText.setVisible(true);

  // wait 3 seconds then restart
  scene.time.delayedCall(3000, () => {
    restart(scene);
  });
}



  function restart(scene) {
  // reset score and state
  score = 0;
  alive = true;
  restarting = false;  // 🆕 allow future deaths

  // hide death text
  deathText.setVisible(false);

  // remove all pipes
  pipes.clear(true, true);

  // reset bird position
  bird.setPosition(80, H / 2);
  bird.setVelocity(0, 0);

  // reset score display
  scoreText.setText("Score: 0");

  // notify server
  socket.emit("player_restart");
}

}
