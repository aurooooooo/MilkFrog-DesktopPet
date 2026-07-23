const frames = {
  idle: "../assets/frames_no_face/idle_no_face.png",
  keyboard_tap_left: "../assets/frames_no_face/keyboard_tap_left_no_face.png",
  keyboard_tap_right: "../assets/frames_no_face/keyboard_tap_right_no_face.png",
  mouse_left_click: "../assets/frames_no_face/mouse_left_click_no_face.png",
  mouse_right_click: "../assets/frames_no_face/mouse_right_click_no_face.png"
};

const stage = document.getElementById("stage");
const scene = document.getElementById("scene");
const menu = document.getElementById("menu");
const sizeSlider = document.getElementById("sizeSlider");
const pupilLeft = document.getElementById("pupilLeft");
const pupilRight = document.getElementById("pupilRight");

const accessoryIds = ["eyePatch", "angry", "meow"];
const audioState = { muted: false };
const accessoryState = { selected: null };

const keyboardTapAudio = new Audio("../assets/audio/keyboard_tap.mp4");
const laughAudio = new Audio("../assets/audio/laugh.mp3");
keyboardTapAudio.preload = "auto";
keyboardTapAudio.volume = 0.38;
laughAudio.preload = "auto";
laughAudio.volume = 0.62;

let keyboardSoundBusy = false;
let keyFlip = 0;
let stateTimer = 0;
let pointerDown = false;
let dragging = false;
let lastPoint = { x: 0, y: 0 };
let lastKeyboardTapAt = 0;
let lastMouseTapAt = 0;

keyboardTapAudio.addEventListener("ended", () => {
  keyboardSoundBusy = false;
});
keyboardTapAudio.addEventListener("pause", () => {
  if (keyboardTapAudio.ended) keyboardSoundBusy = false;
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setState(name, hold = 140) {
  scene.src = frames[name] || frames.idle;
  clearTimeout(stateTimer);
  if (name !== "idle") {
    stateTimer = setTimeout(() => setState("idle", 0), hold);
  }
}

function playKeyboardSound() {
  if (audioState.muted || keyboardSoundBusy) return;
  keyboardSoundBusy = true;
  keyboardTapAudio.currentTime = 0;
  keyboardTapAudio.play().catch(() => {
    keyboardSoundBusy = false;
  });
}

function playSound(audio) {
  if (audioState.muted) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function applyAccessories() {
  for (const id of accessoryIds) {
    const enabled = accessoryState.selected === id;
    const layer = document.getElementById(id);
    layer.hidden = false;
    layer.style.display = enabled ? "block" : "none";
    const button = menu.querySelector(`[data-toggle="${id}"]`);
    if (button) button.setAttribute("aria-checked", String(enabled));
  }
  const muteButton = menu.querySelector('[data-action="mute"]');
  if (muteButton) muteButton.setAttribute("aria-checked", String(audioState.muted));
}

function updatePupilsAt(clientX, clientY) {
  const rect = stage.getBoundingClientRect();
  const cx = rect.left + rect.width * 0.51;
  const cy = rect.top + rect.height * 0.19;
  const nx = clamp((clientX - cx) / (rect.width * 0.40), -1, 1);
  const ny = clamp((clientY - cy) / (rect.height * 0.40), -1, 1);
  const motionScale = Math.min(rect.width / 1100, 1);
  pupilLeft.style.transform = `translate(${nx * 7 * motionScale}px, ${ny * 5 * motionScale}px)`;
  pupilRight.style.transform = `translate(${nx * 7 * motionScale}px, ${ny * 5 * motionScale}px)`;
}

function updatePupils(event) {
  updatePupilsAt(event.clientX, event.clientY);
}

function triggerKeyboardTap() {
  const now = Date.now();
  if (now - lastKeyboardTapAt < 45) return;
  lastKeyboardTapAt = now;
  setState(keyFlip % 2 === 0 ? "keyboard_tap_left" : "keyboard_tap_right", 110);
  playKeyboardSound();
  keyFlip += 1;
}

function triggerMouseClick(button, playLaugh = false) {
  const now = Date.now();
  if (now - lastMouseTapAt < 55) return;
  lastMouseTapAt = now;
  if (menu.classList.contains("open")) return;
  setState(button === 2 ? "mouse_right_click" : "mouse_left_click", 180);
  if (button === 1 && playLaugh) playSound(laughAudio);
}

function showMenu(event) {
  event.preventDefault();
  menu.style.left = "8px";
  menu.style.top = "8px";
  menu.classList.add("open");
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const left = clamp(event.clientX, 8, Math.max(8, window.innerWidth - rect.width - 8));
    const top = clamp(event.clientY, 8, Math.max(8, window.innerHeight - rect.height - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  });
}

function hideMenu() {
  menu.classList.remove("open");
}

async function loadSettings() {
  const settings = await window.petApp.getSettings();
  audioState.muted = Boolean(settings.muted);
  accessoryState.selected = settings.accessory || null;
  sizeSlider.value = Math.round((settings.scale || 0.65) * 100);
  applyAccessories();
}

window.addEventListener("mousemove", (event) => {
  updatePupils(event);
  if (!pointerDown || event.target.closest("#menu")) return;

  const dx = event.screenX - lastPoint.x;
  const dy = event.screenY - lastPoint.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragging = true;
  if (dragging) {
    window.petApp.dragWindow({ x: dx, y: dy });
    lastPoint = { x: event.screenX, y: event.screenY };
  }
});

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  triggerKeyboardTap();
});

window.addEventListener("keyup", () => setState("idle", 0));

stage.addEventListener("mousedown", (event) => {
  if (event.target.closest("#menu")) return;
  if (event.button !== 0) return;
  pointerDown = true;
  dragging = false;
  lastPoint = { x: event.screenX, y: event.screenY };
});

window.addEventListener("mouseup", (event) => {
  if (!pointerDown) return;
  pointerDown = false;
  if (!dragging && event.button === 0) {
    triggerMouseClick(1, true);
  }
});

stage.addEventListener("contextmenu", showMenu);

menu.addEventListener("mousedown", (event) => {
  event.stopPropagation();
});

menu.addEventListener("click", async (event) => {
  event.stopPropagation();
  const button = event.target.closest("button");
  if (!button) return;

  const toggle = button.dataset.toggle;
  if (toggle) {
    accessoryState.selected = accessoryState.selected === toggle ? null : toggle;
    await window.petApp.setSettings({ accessory: accessoryState.selected });
  }
  if (button.dataset.action === "clear") {
    accessoryState.selected = null;
    await window.petApp.setSettings({ accessory: null });
  }
  if (button.dataset.action === "mute") {
    audioState.muted = !audioState.muted;
    await window.petApp.setSettings({ muted: audioState.muted });
  }
  if (button.dataset.action === "quit") {
    window.petApp.quit();
  }
  applyAccessories();
});

sizeSlider.addEventListener("input", (event) => {
  if (!menu.classList.contains("open")) return;
  const scale = Number(event.target.value) / 100;
  window.petApp.setScale(scale);
});

sizeSlider.addEventListener("change", async (event) => {
  if (!menu.classList.contains("open")) return;
  const scale = Number(event.target.value) / 100;
  await window.petApp.setSettings({ scale });
});

window.addEventListener("click", (event) => {
  if (!menu.contains(event.target)) hideMenu();
});

window.petApp.onSettingsChanged((settings) => {
  audioState.muted = Boolean(settings.muted);
  accessoryState.selected = settings.accessory || null;
  sizeSlider.value = Math.round((settings.scale || 0.65) * 100);
  applyAccessories();
});

window.petApp.onGlobalInput((payload) => {
  if (!payload) return;
  if (payload.type === "cursor" && payload.point && payload.bounds) {
    updatePupilsAt(payload.point.x - payload.bounds.x, payload.point.y - payload.bounds.y);
  }
  if (payload.type === "key") {
    triggerKeyboardTap();
  }
  if (payload.type === "mouseDown") {
    triggerMouseClick(payload.button);
  }
});

loadSettings();
