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

  // Base logical resolution (16:9) – will be scaled
  const W = 1280;
  const H = 720;

  const config = {
    type: Phaser.AUTO,
    width: W,
    height: H,
    parent: "game", // <div id="game"></div>
    backgroundColor: "#000000",
    physics: {
      default: "arcade",
      arcade: {
        gravity: { y: 1200 },
        debug: false,              // off for mobile
        debugShowBody: false,
        debugShowStaticBody: false,
        debugShowBounds: false,
        debugShowVelocity: false
      }
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      resizeInterval: 100
    },
    scene: { preload, create, update }
  };

  const game = new Phaser.Game(config);

  let bird,
    pipes,
    alive = false,        // starts false until Start pressed
    running = false,
    lastSend = 0,
    bg,
    scoreText,
    highScoreText,
    timeText,
    deathText,
    newRecordText,
    startButton;

  // Sounds
  let startSound, clickSound, gameOverSound;

  // Survival-based scoring
  let survivalMs = 0;
  let bestSurvivalMs = 0;
  let brokeRecordThisRun = false;

  // ---------- Rounded button helper ----------
  function createRoundedButton(scene, x, y, text, callback) {
    const radius = 25;
    const width = 260;   // fixed width (fits both "START" and "PLAY AGAIN")
    const height = 80;
    const bgColor = 0x007bff;
    const bgHover = 0x005fcc;

    // Create graphics for rounded rectangle
    const graphics = scene.add.graphics();
    graphics.fillStyle(bgColor, 1);
    graphics.fillRoundedRect(0, 0, width, height, radius);

    const textureKey = "button_rect";
    graphics.generateTexture(textureKey, width, height);
    graphics.destroy();

    // Create image from texture
    const button = scene.add.image(x, y, textureKey).setInteractive({ useHandCursor: true });
    button.setOrigin(0.5);

    // Create label text on top
    const label = scene.add.text(x, y, text, {
      fontFamily: "Arial",
      fontSize: "32px",
      color: "#ffffff"
    }).setOrigin(0.5);

    // Attach label + colors for later use
    button.label = label;
    button.bgColor = bgColor;
    button.bgHover = bgHover;

    // Hover effect (on desktop mostly)
    button.on("pointerover", () => {
      button.setTint(bgHover);
    });
    button.on("pointerout", () => {
      button.clearTint();
    });

    // Click handler
    button.on("pointerdown", callback);

    // Helper to change text later (e.g., "PLAY AGAIN")
    button.setLabelText = (newText) => {
      button.label.setText(newText);
      button.label.setPosition(button.x, button.y);
    };

    // Sync visibility function
    button.setVisibleWithLabel = (visible) => {
      button.setVisible(visible);
      button.label.setVisible(visible);
    };

    return button;
  }

  function preload() {
    console.log("preload");
    this.load.image("bg", "background.png");
    this.load.image("bird", "carpet.png");
    this.load.image("pipe", "minarete.png");

    // Sounds
    this.load.audio("start", "arabian_dramatic_sting.wav");
    this.load.audio("click", "tick.wav");
    this.load.audio("gameover", "gameover_retro_3s.wav");
  }

  function create() {
    console.log("create");

    // --- Background ---
    bg = this.add.image(W / 2, H / 2, "bg");
    bg.setDisplaySize(W, H);

    // --- Bird (carpet rider) ---
    bird = this.physics.add.sprite(W * 0.2, H / 2, "bird");
    bird.setScale(0.7);

    // Tuned rectangular hitbox for carpet rider (img 200x139)
    bird.body.setSize(140, 110);  // width, height
    bird.body.setOffset(30, 15);  // x, y offset inside sprite

    pipes = this.physics.add.group();

    // --- Current score (top-left): seconds with 1 decimal ---
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
    deathText = this.add.text(W / 2, H / 2 - 60, "Game Over!", {
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

    // --- Setup sounds ---
    startSound = this.sound.add("start");
    clickSound = this.sound.add("click");
    gameOverSound = this.sound.add("gameover");

    // --- Rounded Start button ---
    startButton = createRoundedButton(
      this,
      W / 2,
      H / 2 + 40,
      "START",
      () => {
        if (!running) {
          // Try to go fullscreen on mobile (must be inside user gesture)
          if (!this.scale.isFullscreen) {
            this.scale.startFullscreen();
          }
          startRun(this);
        }
      }
    );

    // Input: click/tap to flap + click sound (only when in a run)
    this.input.on("pointerdown", (pointer, objects) => {
      // If the tap hits the button, let button handle it
      if (objects && objects.length > 0) return;

      if (!alive || !running) return; // ignore clicks when not in a run
      bird.setVelocityY(-380);
      if (clickSound) clickSound.play();
    });

    // Pipe spawner (spawn only when running)
    this.time.addEvent({
      delay: 1400,
      loop: true,
      callback: () => spawnPipes(this)
    });

    // Collision: bird vs pipes
    this.physics.add.overlap(bird, pipes, () => die(this));
  }

  // ---- Start a run when the button is pressed ----
  function startRun(scene) {
    console.log("startRun");

    // Reset run state
    alive = true;
    running = true;
    survivalMs = 0;
    brokeRecordThisRun = false;

    deathText.setVisible(false);
    newRecordText.setVisible(false);
    newRecordText.setAlpha(1);

    scoreText.setText("Score: 0.0");
    timeText.setText("Time: 00:00");

    // Clear obstacles from previous run (if any)
    pipes.clear(true, true);

    // Reset bird position & velocity
    bird.setPosition(W * 0.2, H / 2);
    bird.setVelocity(0, 0);

    // Hide button while playing
    startButton.setVisibleWithLabel(false);

    // Notify server (reuse restart message as "start run")
    socket.emit("player_restart");

    // Play start sound
    if (startSound) startSound.play();
  }

  function update(time, delta) {
    if (!alive || !running) return;

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
      const secondsScore = Math.floor((survivalMs / 1000) * 10) / 10;
      socket.emit("player_state", { score: secondsScore, alive: true });
      lastSend = time;
    }
  }

  function spawnPipes(scene) {
    // Only spawn while run is active
    if (!alive || !running) return;

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

    // Slim hitbox for minaret (39 x 200 original)
    top.body.setSize(24, 200);
    top.body.setOffset(7, 0);

    bot.body.setSize(24, 200);
    bot.body.setOffset(7, 0);
  }

  function die(scene) {
    if (!alive || !running) return;
    alive = false;
    running = false;

    // score at death (seconds)
    const finalSeconds = survivalMs / 1000;
    const score = Math.floor(finalSeconds * 10) / 10;

    // Play game over sound once
    if (gameOverSound) gameOverSound.play();

    socket.emit("player_state", { score, alive: false });

    deathText.setText("Game Over!");
    deathText.setVisible(true);

    // Show button again to allow manual restart
    startButton.setLabelText("PLAY AGAIN");
    startButton.setVisibleWithLabel(true);
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
