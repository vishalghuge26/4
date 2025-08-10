/* main.js
   Phaser 3 — 4-lane car dodger
   Uses Phaser Arcade physics and simple tweens for lane changes.
   Remote assets (images and sounds) are loaded directly from free sources.
*/

/*
  Asset attributions (images & audio links are also below in this message):
  - Player / enemy car images: OpenGameArt (CC0). Example pages:
    https://opengameart.org/content/car  and https://opengameart.org/content/cars-top-down-view
  - Coin: OpenGameArt (CC0).
  - Sounds recommended from Mixkit / SoundJay / OpenGameArt free collections (see attributions below).
*/

const CONFIG = {
  width: 540,             // base width; Phaser will auto scale with scale mode
  height: 960,            // tall mobile-first canvas
  backgroundColor: 0x7ec850,
  parent: 'game-container',
  scene: [BootScene, PlayScene],
  physics: {
    default: 'arcade',
    arcade: {
      debug: false
    }
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    parent: 'game-container',
    width: CONFIG ? CONFIG.width : 540,
    height: CONFIG ? CONFIG.height : 960
  }
};

/* --- Preload / Boot Scene --- */
function BootScene() {
  Phaser.Scene.call(this, { key: 'BootScene' });
}
BootScene.prototype = Object.create(Phaser.Scene.prototype);
BootScene.prototype.constructor = BootScene;

BootScene.prototype.preload = function () {
  // Progress UI (we mirror to the DOM #preload-overlay)
  const progressBar = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  // ---------- REMOTE ASSET URLs ----------
  // 2 car sources from OpenGameArt (public domain / CC0)
  this.load.image('carsheet', 'https://opengameart.org/sites/default/files/text3062.png'); // many colored cars: we'll draw player from this
  this.load.image('enemycar', 'https://opengameart.org/sites/default/files/car0.png');     // single small car

  // coin
  this.load.image('coin', 'https://opengameart.org/sites/default/files/Coin.png');

  // small tree for roadside/parallax
  this.load.image('tree', 'https://opengameart.org/sites/default/files/Tree.png');

  // load a tiny background music and sfx (these are example remote sources;
  // if a server blocks them you'll see no audio — swap to a permissive host if needed)
  // NOTE: if these fail to load due to CORS, audio will simply be disabled.
  this.load.audio('bgm', [
    'https://assets.mixkit.co/music/preview/mixkit-cute-happy-breeze-127.mp3'
  ]);
  this.load.audio('whoosh', [
    'https://assets.mixkit.co/sfx/preview/mixkit-fast-arcade-impact-1694.mp3'
  ]);
  this.load.audio('coin-sfx', [
    'https://assets.mixkit.co/sfx/preview/mixkit-quick-jump-arcade-237.mp3'
  ]);
  this.load.audio('crash', [
    'https://assets.mixkit.co/sfx/preview/mixkit-car-crash-1420.mp3'
  ]);

  // when the loader reports progress, update DOM
  this.load.on('progress', (value) => {
    const pct = Math.round(value * 100);
    progressBar.style.width = pct + '%';
    progressText.innerText = `Loading... ${pct}%`;
  });
  this.load.on('complete', () => {
    // hide preload overlay after a small delay for UX
    setTimeout(() => {
      const overlay = document.getElementById('preload-overlay');
      overlay.classList.add('hidden');
    }, 200);
  });
};

BootScene.prototype.create = function () {
  // start PlayScene
  this.scene.start('PlayScene');
};


/* --- Main gameplay scene --- */
function PlayScene() {
  Phaser.Scene.call(this, { key: 'PlayScene' });
}
PlayScene.prototype = Object.create(Phaser.Scene.prototype);
PlayScene.prototype.constructor = PlayScene;

PlayScene.prototype.create = function () {
  // basic variables
  this.baseSpeed = 180;        // initial downward speed for enemies
  this.speedMultiplier = 1.0;  // increases with score
  this.spawnTimer = 0;
  this.spawnInterval = Phaser.Math.Between(800, 1200); // ms
  this.score = 0;
  this.isGameOver = false;

  // lanes (4 lanes centered on the road)
  this.laneCount = 4;
  this.roadWidth = this.scale.width * 0.6;
  const centerX = this.scale.width / 2;
  const laneStep = this.roadWidth / (this.laneCount - 1);
  this.laneX = [];
  const leftMost = centerX - this.roadWidth / 2;
  for (let i=0;i<this.laneCount;i++){
    this.laneX.push(leftMost + i * laneStep);
  }

  // background elements: road, dashed lanes, roadside grass stripes and scrolling trees for parallax
  this.createScrollingBackground();

  // groups
  this.enemies = this.physics.add.group();
  this.coins = this.physics.add.group();

  // Player car (we'll use a portion of the carsheet by texture crop)
  // Create player as image + physics body; we add a shadow graphic beneath
  this.player = this.add.sprite(this.laneX[1], this.scale.height * 0.78, 'carsheet').setOrigin(0.5,0.7);
  this.player.setDisplaySize(78, 120);
  this.physics.add.existing(this.player, false);
  this.player.body.setSize(this.player.displayWidth * 0.8, this.player.displayHeight * 0.6);
  this.player.body.setAllowGravity(false);
  this.player.currentLane = 1;

  // subtle shadow under car
  this.playerShadow = this.add.ellipse(this.player.x, this.player.y + 20, this.player.displayWidth * 0.88, 18, 0x000000, 0.2);
  this.playerShadow.setDepth(this.player.depth - 1);

  // Camera / world bounds
  this.physics.world.setBounds(0, 0, this.scale.width, this.scale.height);

  // input: keyboard
  this.cursors = this.input.keyboard.createCursorKeys();
  // tie mobile buttons to the same functions
  document.getElementById('left-btn').addEventListener('pointerdown', ()=> this.tryMoveLeft());
  document.getElementById('right-btn').addEventListener('pointerdown', ()=> this.tryMoveRight());

  // on-screen UI references
  this.scoreText = document.getElementById('score');
  this.highscoreText = document.getElementById('highscore');

  // highscore load
  this.highscore = parseInt(localStorage.getItem('car_dodger_high') || '0', 10);
  this.updateScoreUI();

  // collision detection
  this.physics.add.overlap(this.player, this.coins, this.collectCoin, null, this);
  this.physics.add.overlap(this.player, this.enemies, this.handleCrash, null, this);

  // audio
  this.sfx = {
    bgm: this.sound.add('bgm', { loop: true, volume: 0.5 }),
    whoosh: this.sound.add('whoosh', { volume: 0.7 }),
    coin: this.sound.add('coin-sfx', { volume: 0.6 }),
    crash: this.sound.add('crash', { volume: 0.9 })
  };

  // try to start music (may be blocked until user gesture)
  this.soundOn = true;
  this.tryPlayBGM();

  // mute/unmute
  document.getElementById('mute-btn').addEventListener('click', ()=> {
    this.soundOn = !this.soundOn;
    this.updateSoundState();
  });
  this.updateSoundState();

  // mobile: also allow tapping the canvas to play (some browsers block audio until gesture)
  this.input.on('pointerdown', ()=> this.tryPlayBGM());

  // restart button
  document.getElementById('restart-btn').addEventListener('click', ()=> this.restartGame());

  // show/hide mobile controls depending on screen width (CSS handles most)
  // scoreboard refresh interval
  this.time.addEvent({
    delay: 200,
    loop: true,
    callback: ()=> this.updateScoreUI()
  });
};

PlayScene.prototype.createScrollingBackground = function () {
  // draw a road using graphics so it's crisp and infinite-scroll
  const g = this.add.graphics();
  g.fillStyle(0x2b2b2b);
  // road rectangle
  const roadX = (this.scale.width - this.roadWidth)/2;
  g.fillRoundedRect(roadX, 0, this.roadWidth, this.scale.height, 6);
  g.generateTexture('roadTexture', Math.round(this.roadWidth), Math.round(this.scale.height));
  g.destroy();

  this.road = this.add.tileSprite(this.scale.width/2, this.scale.height/2, this.roadWidth, this.scale.height, 'roadTexture');
  this.road.setDepth(-2);

  // dashed center lines: create smaller tile sprite for dashes
  const dashW = 6;
  const dashH = 40;
  const dashGap = 30;
  const dashGraphics = this.add.graphics();
  dashGraphics.fillStyle(0xffffff,1);
  for (let y=0;y<dashH;y++){
    dashGraphics.fillRect( (this.roadWidth/2) - (dashW/2), y, dashW, 8 );
  }
  dashGraphics.generateTexture('dashTexture', Math.round(this.roadWidth), dashH*1);
  dashGraphics.destroy();

  // Add tileSprite and mask so dashes appear centered
  this.dashes = this.add.tileSprite(this.scale.width/2, this.scale.height/2, this.roadWidth, this.scale.height, 'dashTexture');
  this.dashes.setDepth(-1);

  // roadside grass areas (we'll draw repeating tree sprites for parallax)
  this.treeLayer = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, 'tree');
  this.treeLayer.setOrigin(0,0);
  this.treeLayer.setDepth(-3);
  this.treeLayer.setTileScaleMode(Phaser.Textures.NEAREST);
  this.treeLayer.alpha = 0.95;
};

PlayScene.prototype.tryPlayBGM = function () {
  if (this.soundOn && this.sfx.bgm && !this.sfx.bgm.isPlaying) {
    try { this.sfx.bgm.play(); } catch(e) { /* may be blocked until user gesture */ }
  }
}

PlayScene.prototype.updateSoundState = function () {
  if (!this.soundOn) {
    this.sound.pauseAll();
    document.getElementById('mute-btn').innerText = '🔇';
  } else {
    document.getElementById('mute-btn').innerText = '🔊';
    this.tryPlayBGM();
  }
};

/* player movement helpers: smooth tween between lanes */
PlayScene.prototype.tryMoveLeft = function () {
  if (this.isGameOver) return;
  if (this.playerTween && this.playerTween.isPlaying()) return;
  if (this.player.currentLane > 0) {
    this.player.currentLane--;
    this.tweenPlayerToLane(this.player.currentLane);
    if (this.sfx.whoosh && this.soundOn) this.sfx.whoosh.play();
  }
};
PlayScene.prototype.tryMoveRight = function () {
  if (this.isGameOver) return;
  if (this.playerTween && this.playerTween.isPlaying()) return;
  if (this.player.currentLane < this.laneCount - 1) {
    this.player.currentLane++;
    this.tweenPlayerToLane(this.player.currentLane);
    if (this.sfx.whoosh && this.soundOn) this.sfx.whoosh.play();
  }
};

PlayScene.prototype.tweenPlayerToLane = function (laneIdx) {
  const targetX = this.laneX[laneIdx];
  // smooth tween
  if (this.playerTween) this.playerTween.stop();
  this.playerTween = this.tweens.add({
    targets: [this.player, this.playerShadow],
    x: targetX,
    duration: 180,
    ease: 'Cubic.easeOut'
  });
};

/* coin collection */
PlayScene.prototype.collectCoin = function (player, coin) {
  if (this.isGameOver) return;
  coin.destroy();
  this.score += 10 + Math.floor(this.speedMultiplier * 2);
  // occasional bonus multiplier
  if (this.sfx.coin && this.soundOn) this.sfx.coin.play();
};

/* crash handling */
PlayScene.prototype.handleCrash = function (player, enemy) {
  if (this.isGameOver) return;
  this.isGameOver = true;

  // flash / shake
  if (this.sfx.crash && this.soundOn) this.sfx.crash.play();
  this.cameras.main.shake(350, 0.015);

  // stop background music
  if (this.sfx.bgm) this.sfx.bgm.stop();

  // Show Game Over overlay
  const go = document.getElementById('game-over');
  document.getElementById('final-score').innerText = `Score: ${this.score}`;
  go.classList.remove('hidden');

  // save high score
  if (this.score > this.highscore) {
    this.highscore = this.score;
    localStorage.setItem('car_dodger_high', String(this.highscore));
  }
};

/* restart */
PlayScene.prototype.restartGame = function () {
  // reset overlay
  document.getElementById('game-over').classList.add('hidden');

  // cleanup groups
  this.enemies.clear(true,true);
  this.coins.clear(true,true);

  // reset vars
  this.score = 0;
  this.speedMultiplier = 1.0;
  this.baseSpeed = 180;
  this.spawnInterval = Phaser.Math.Between(800,1200);
  this.isGameOver = false;
  this.player.currentLane = 1;
  this.player.setPosition(this.laneX[1], this.scale.height * 0.78);
  this.playerShadow.setPosition(this.player.x, this.player.y + 20);

  // restart music
  if (this.sfx.bgm && this.soundOn) this.sfx.bgm.play();
};

/* spawn enemy car */
PlayScene.prototype.spawnEnemy = function () {
  const lane = Phaser.Math.Between(0, this.laneCount - 1);
  const x = this.laneX[lane];
  const enemy = this.enemies.create(x, -120, 'enemycar');
  enemy.setOrigin(0.5,0.7);
  enemy.displayHeight = 92;
  enemy.displayWidth = 56;
  enemy.body.setAllowGravity(false);
  enemy.setDepth(2);

  // subtle shadow via tint + alpha (a simple 'shadow' effect)
  enemy.setPipeline(); // keep default; can add shadows via extra graphics if needed

  // set velocity downward
  const speed = this.baseSpeed * this.speedMultiplier * (1 + Math.random()*0.25);
  enemy.body.setVelocityY(speed);
  enemy.outOfBoundsKill = true;
  enemy.checkWorldBounds = true;
};

/* spawn coin with smaller probability */
PlayScene.prototype.spawnCoin = function () {
  const lane = Phaser.Math.Between(0, this.laneCount - 1);
  const x = this.laneX[lane];
  const coin = this.coins.create(x, -80, 'coin');
  coin.setOrigin(0.5,0.5);
  coin.displayWidth = 46;
  coin.displayHeight = 46;
  coin.body.setAllowGravity(false);
  coin.setDepth(2);
  const speed = (this.baseSpeed * 0.9) * this.speedMultiplier;
  coin.body.setVelocityY(speed);
};

/* cleanup off-screen objects periodically */
PlayScene.prototype.cleanupOffscreen = function () {
  this.enemies.children.iterate((e)=>{
    if (!e) return;
    if (e.y - 200 > this.scale.height){
      e.destroy();
    }
  });
  this.coins.children.iterate((c)=>{
    if (!c) return;
    if (c.y - 200 > this.scale.height) c.destroy();
  });
};

/* update UI */
PlayScene.prototype.updateScoreUI = function () {
  document.getElementById('score').innerText = `Score: ${this.score}`;
  document.getElementById('highscore').innerText = `High: ${this.highscore}`;
};

/* Phaser update loop */
PlayScene.prototype.update = function (time, delta) {
  if (!this.player || this.isGameOver) return;

  // Move dashes and background to simulate forward motion
  const worldSpeed = (this.baseSpeed * this.speedMultiplier * delta/1000);
  this.dashes.tilePositionY += worldSpeed * 0.95;
  this.road.tilePositionY += worldSpeed * 0.8;
  this.treeLayer.tilePositionY += worldSpeed * 0.35;

  // keyboard controls
  if (Phaser.Input.Keyboard.JustDown(this.cursors.left)) this.tryMoveLeft();
  if (Phaser.Input.Keyboard.JustDown(this.cursors.right)) this.tryMoveRight();

  // spawn enemies & coins
  this.spawnTimer += delta;
  if (this.spawnTimer > this.spawnInterval) {
    this.spawnTimer = 0;
    this.spawnInterval = Phaser.Math.Between(800, 1200);
    // spawn an enemy
    this.spawnEnemy();

    // small chance to spawn a coin alongside
    if (Math.random() < 0.26) this.spawnCoin();
  }

  // increment score over time and increase pace slightly
  this.score += Math.floor( (delta/1000) * 2 * (this.speedMultiplier) );
  // every 30 points slightly increase speed multiplier
  if (this.score > 0 && this.score % 30 === 0) {
    this.speedMultiplier = 1.0 + (this.score / 200); // gentle ramp
  }

  // cleanup off-screen objects
  this.cleanupOffscreen();

  // adjust player shadow position each frame
  this.playerShadow.x = this.player.x;
  this.playerShadow.y = this.player.y + 22;

  // update displayed UI
  this.updateScoreUI();
};

/* --- Boot up the game (create config object now that the class defns exist) --- */
// Because Phaser config references BootScene and PlayScene constructors, define config after scenes defined
const gameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 540,
  height: 960,
  backgroundColor: 0x7ec850,
  scene: [BootScene, PlayScene],
  physics: {
    default: 'arcade',
    arcade: { debug: false }
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
};

window.addEventListener('load', () => {
  // create the game
  window.game = new Phaser.Game(gameConfig);

  // make mobile buttons visible when touch device
  if (!('ontouchstart' in window) && !navigator.maxTouchPoints) {
    // no touch -> hide mobile controls (CSS already hides on wide screens)
    document.getElementById('mobile-controls').style.display = 'flex';
  }
});
