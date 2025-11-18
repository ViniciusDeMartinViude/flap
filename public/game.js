// ---- Socket + join UI ----
const socket = io();

let joined = false;

document.getElementById("join").onclick = () => {
  const code = document.getElementById("room").value.trim().toUpperCase();
  const name = document.getElementById("name").value.trim();
  if (!code) return alert("Enter room code");

  socket.emit("join_as_player", { code, name }, (res) => {
    if (!res || !res.ok) return alert(res?.error || "Unable to join");
    document.querySelector(".join").style.display = "none";
    startGame();
  });
};

// ---- Phaser game ----
function startGame() {
  console.log("startGame called");

  // 16:9 desktop resolution
  const W = 1280, H = 720;

  const config = {
    type: Phaser.AUTO,
    width: W,
    height: H,
    parent: "game", // <div id="game"></div> in your HTML
    physics: {
      default: "arcade",
      arcade: {
        gravity: { y: 1200 }
      }
    },
    scene: { preload, create, update }
  };

  const game = new Phaser.Game(config);

  let bird,
    pipes,
    alive = true,
    restarting = false,
    lastSend = 0,
    bg,
    scoreText,
    highScoreText,
    timeText,
    deathText,
    newRecordText;
   // tickSound;

  // Survival-based scoring
  let survivalMs = 0;       // current run, in milliseconds
  let bestSurvivalMs = 0;   // best run (highscore), in ms
  let brokeRecordThisRun = false;
  let lastTickSecond = 0;

  function preload() {
    console.log("preload");
    this.load.image("bg", "final_background.png");
    this.load.image("bird", "fly2.png");
    this.load.image("pipe", "minaret2.png");

    // optional tick sound
   // this.load.audio("tick", "tick.wav");
  }

  function create() {
    console.log("create");

    // --- Background ---
    bg = this.add.image(W / 2, H / 2, "bg");
    bg.setDisplaySize(W, H);

    // --- Bird & pipes ---
    bird = this.physics.add
      .sprite(W * 0.2, H / 2, "bird")
      .setScale(0.7);

    pipes = this.physics.add.group();

    // --- Current score (top-left): shows seconds with 1 decimal ---
    scoreText = this.add.text(24, 24, "Score: 0.0", {
      fontFamily: "Arial",
      fontSize: "32px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 6
    });

    // --- Highscore (top-right) ---
    highScoreText = this.add.text(W - 24, 24, "Best: 00:00", {
      fontFamily: "Arial",
      fontSize: "32px",
      color: "#ffff66",
      stroke: "#000000",
      strokeThickness: 6,
      align: "right"
    }).setOrigin(1, 0);

    // --- Survival time (top-center) ---
    timeText = this.add.text(W / 2, 24, "Time: 00:00", {
      fontFamily: "Arial",
      fontSize: "32px",
      color: "#66ccff",
      stroke: "#000000",
      strokeThickness: 6
    }).setOrigin(0.5, 0);

    // --- Death message (center) ---
    deathText = this.add.text(W / 2, H / 2, "You Died!", {
      fontFamily: "Arial",
      fontSize: "64px",
      color: "#ff3333",
      stroke: "#000000",
      strokeThickness: 8
    })
      .setOrigin(0.5)
      .setVisible(false);

    // --- New record message (upper-center) ---
    newRecordText = this.add.text(W / 2, H * 0.2, "NEW HIGHSCORE!", {
      fontFamily: "Arial",
      fontSize: "48px",
      color: "#00ff99",
      stroke: "#000000",
      strokeThickness: 8
    })
      .setOrigin(0.5)
      .setVisible(false);

    // --- Tick sound setup ---
   // tickSound = this.sound.add("tick");

    // Input: click/tap to flap
    this.input.on("pointerdown", () => {
      if (!alive) return; // ignore clicks when dead / waiting
      bird.setVelocityY(-380);
    });

    // Pipe spawner
    this.time.addEvent({
      delay: 1400,
      loop: true,
      callback: () => spawnPipes(this)
    });

    // Collision: bird vs pipes
    this.physics.add.overlap(bird, pipes, () => die(this));
  }

  function update(time, delta) {
    if (!alive) return;

    // Out of bounds
    if (bird.y > H || bird.y < 0) {
      return die(this);
    }

    // --- Survival scoring: +time every frame ---
    survivalMs += delta;
    const seconds = survivalMs / 1000;
    const score = Math.floor(seconds * 10) / 10; // one decimal

    scoreText.setText("Score: " + score.toFixed(1));
    timeText.setText("Time: " + formatTime(survivalMs));

    // Tick sound each full second (optional)
    const currentSecInt = Math.floor(seconds);
    if (currentSecInt > lastTickSecond) {
      lastTickSecond = currentSecInt;
      //if (tickSound) tickSound.play();
    }

    // Highscore check (based on survival time)
    if (survivalMs > bestSurvivalMs) {
      bestSurvivalMs = survivalMs;
      highScoreText.setText("Best: " + formatTime(bestSurvivalMs));

      // Show "NEW HIGHSCORE!" once per run
      if (!brokeRecordThisRun) {
        brokeRecordThisRun = true;
        newRecordText.setVisible(true);
        newRecordText.setAlpha(1);

        this.tweens.add({
          targets: newRecordText,
          alpha: { from: 1, to: 0 },
          duration: 1500,
          onComplete: () => {
            newRecordText.setVisible(false);
            newRecordText.setAlpha(1);
          }
        });
      }
    }

    // Telemetry to server (throttled)
    if (time - lastSend > 66) {
      socket.emit("player_state", { score, alive: true });
      lastSend = time;
    }
  }

  function spawnPipes(scene) {
    if (!alive) return;

    const gap = 220;
    const margin = 140;
    const center = margin + Math.random() * (H - 2 * margin);
    const topY = center - gap / 2 - 360;
    const botY = center + gap / 2;

    const pipeSpeed = -220;

    const top = pipes
      .create(W + 80, topY, "pipe")
      .setImmovable(true)
      .setVelocityX(pipeSpeed);

    const bot = pipes
      .create(W + 80, botY, "pipe")
      .setImmovable(true)
      .setVelocityX(pipeSpeed)
      .setFlipY(true);

    top.body.allowGravity = false;
    bot.body.allowGravity = false;

    // NOTE: no scoring zone here anymore — scoring is purely survival time
  }

  function die(scene) {
    if (!alive || restarting) return;
    alive = false;
    restarting = true;

    // score at death (seconds)
    const finalSeconds = survivalMs / 1000;
    const score = Math.floor(finalSeconds * 10) / 10;

    socket.emit("player_state", { score, alive: false });

    deathText.setText("You Died!");
    deathText.setVisible(true);

    // Wait 3 seconds then restart
    scene.time.delayedCall(3000, () => {
      restart(scene);
    });
  }

  function restart(scene) {
    alive = true;
    restarting = false;

    // Reset survival time but keep bestSurvivalMs (highscore)
    survivalMs = 0;
    brokeRecordThisRun = false;
    lastTickSecond = 0;

    deathText.setVisible(false);
    newRecordText.setVisible(false);
    newRecordText.setAlpha(1);

    scoreText.setText("Score: 0.0");
    timeText.setText("Time: 00:00");
    // highScoreText already shows best time

    // Clear all pipes
    pipes.clear(true, true);

    // Reset bird
    bird.setPosition(W * 0.2, H / 2);
    bird.setVelocity(0, 0);

    socket.emit("player_restart");
  }

  // Helper: format ms -> mm:ss
  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return `${mm}:${ss}`;
  }
}
