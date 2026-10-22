const ACCESSORY_VOICES = Object.freeze(["gagadilaxia.mp3", "gajiaosei.mp3", "ganbadie.mp3", "andi.mp3"]);

class PetMedia {
  constructor(video, scene, rig, onChange, onError) {
    this.video = video;
    this.scene = scene;
    this.rig = rig;
    this.onChange = onChange;
    this.onError = onError;
    this.muted = false;
    this.laughing = false;
    this.generation = 0;
    this.keyboardAudio = new Audio();
    this.effectAudio = new Audio();
    for (const audio of [this.keyboardAudio, this.effectAudio]) {
      audio.preload = "none";
      audio.addEventListener("ended", () => this.releaseAudio(audio));
      audio.addEventListener("error", () => this.releaseAudio(audio));
    }
    video.addEventListener("playing", () => {
      if (!this.laughing) return;
      video.hidden = false;
      scene.style.visibility = "hidden";
    });
    video.addEventListener("ended", () => this.stopLaugh());
    video.addEventListener("error", () => {
      if (!this.laughing) return;
      this.stopLaugh();
      this.onError("大笑视频播放失败，请检查媒体文件是否完整。");
    });
  }

  releaseAudio(audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  setMuted(muted) {
    this.muted = muted;
    this.video.muted = muted;
    if (muted) {
      this.releaseAudio(this.keyboardAudio);
      this.releaseAudio(this.effectAudio);
    }
  }

  playAudio(audio, file, volume) {
    if (this.muted || this.laughing) return;
    this.releaseAudio(audio);
    audio.src = `../assets/runtime/${file}`;
    audio.volume = volume;
    audio.play().catch(() => {
      if (audio.getAttribute("src") === `../assets/runtime/${file}`) this.releaseAudio(audio);
    });
  }

  playKeyboard() {
    if (this.keyboardAudio.getAttribute("src")) return;
    this.playAudio(this.keyboardAudio, "keyboard-tap.ogg", 0.38);
  }

  playClick() { this.playAudio(this.effectAudio, "click-laugh.ogg", 0.62); }

  playAccessoryVoice() {
    const file = ACCESSORY_VOICES[Math.floor(Math.random() * ACCESSORY_VOICES.length)];
    this.playAudio(this.effectAudio, file, 0.7);
  }

  toggleLaugh() {
    if (this.laughing) { this.stopLaugh(); return; }
    const generation = ++this.generation;
    this.releaseAudio(this.keyboardAudio);
    this.releaseAudio(this.effectAudio);
    this.laughing = true;
    this.rig.setSuspended(true);
    this.video.src = "../assets/runtime/laugh.webm";
    this.video.muted = this.muted;
    this.video.volume = 0.7;
    this.onChange();
    this.video.play().catch(error => {
      if (generation !== this.generation) return;
      this.stopLaugh();
      this.onError(`大笑视频无法播放：${error.message}`);
    });
  }

  stopLaugh() {
    if (!this.laughing) return;
    this.generation++;
    this.laughing = false;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.hidden = true;
    this.scene.style.visibility = "";
    this.rig.setSuspended(false);
    this.onChange();
  }

  stopAll() {
    this.stopLaugh();
    this.releaseAudio(this.keyboardAudio);
    this.releaseAudio(this.effectAudio);
  }
}
