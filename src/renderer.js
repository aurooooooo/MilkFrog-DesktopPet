const stage = document.getElementById("stage");
const scene = document.getElementById("scene");
const rig = new MilkFrogRig(scene);

const accessoryIds = ["eyePatch", "angry", "meow"];
const audioState = { muted: false, gameMode: false };
const accessoryState = { selected: null };

const media = new PetMedia(document.getElementById("laughVideo"), scene, rig,
  () => window.petApp.setLaughing(media.laughing),
  showStatus);
const inputState = createInputState();
const codeToVk = new Map(Object.entries(KEY_BINDINGS).map(([vk, binding]) => [binding.code, Number(vk)]));
let pointerDown = false;
let dragging = false;
let lastPoint = { x: 0, y: 0 };

function renderInput() {
  rig.setState(inputState.snapshot());
}

function showStatus(message) {
  const status = document.getElementById("petStatus");
  status.textContent = message;
  status.hidden = !message;
}

function applyAccessories() {
  rig.setAccessory(accessoryState.selected);
  media.setMuted(audioState.muted);
}

function updateKey(vk, down) {
  if (!inputState.key(vk, down)) return;
  if (down) media.playKeyboard();
  renderInput();
}

function updateMouseButton(button, down) {
  if (!inputState.mouse(button, down)) return;
  renderInput();
}

async function loadSettings() {
  const settings = await window.petApp.getSettings();
  audioState.muted = Boolean(settings.muted);
  audioState.gameMode = Boolean(settings.gameMode);
  accessoryState.selected = settings.accessory || null;
  applyAccessories();
}

window.addEventListener("mousemove", (event) => {
  if (!pointerDown) return;

  const dx = event.screenX - lastPoint.x;
  const dy = event.screenY - lastPoint.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragging = true;
  if (dragging) {
    window.petApp.dragWindow({ x: dx, y: dy });
    lastPoint = { x: event.screenX, y: event.screenY };
  }
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Escape") { media.stopLaugh(); return; }
  if (event.repeat) return;
  updateKey(codeToVk.get(event.code), true);
});

window.addEventListener("keyup", (event) => updateKey(codeToVk.get(event.code), false));

stage.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  pointerDown = true;
  updateMouseButton(1, true);
  dragging = false;
  lastPoint = { x: event.screenX, y: event.screenY };
});

window.addEventListener("mouseup", (event) => {
  if (!pointerDown) return;
  pointerDown = false;
  updateMouseButton(1, false);
  if (!dragging && event.button === 0) {
    if (media.laughing) media.stopLaugh();
    else media.playClick();
  }
});

window.petApp.onSettingsChanged((settings) => {
  audioState.muted = Boolean(settings.muted);
  audioState.gameMode = Boolean(settings.gameMode);
  accessoryState.selected = settings.accessory || null;
  applyAccessories();
});

window.petApp.onAction(async (action) => {
  try {
    showStatus("");
    if (action === "laugh") media.toggleLaugh();
    if (action === "stop") media.stopAll();
    if (action && typeof action === "object" && (action.type === "clear" ||
      (action.type === "accessory" && accessoryIds.includes(action.id)))) {
      media.stopLaugh();
      const next = action.type === "clear" || accessoryState.selected === action.id ? null : action.id;
      const changed = next !== accessoryState.selected;
      await window.petApp.setSettings({ accessory: next });
      accessoryState.selected = next;
      applyAccessories();
      if (changed) media.playAccessoryVoice();
    }
  } catch (error) { showStatus("设置失败：" + error.message); }
});

window.petApp.onGlobalInput((payload) => {
  if (!payload) return;
  if (payload.type === "cursor" && payload.point && payload.displayBounds) {
    const display = payload.displayBounds;
    if (!(display.width > 0 && display.height > 0)) return;
    const changed = inputState.cursor(
      (payload.point.x - display.x) / display.width * 2 - 1,
      (payload.point.y - display.y) / display.height * 2 - 1
    );
    if (changed) renderInput();
  }
  if (payload.type === "keyDown" || payload.type === "keyUp") {
    updateKey(payload.vk, payload.type === "keyDown");
  }
  if (payload.type === "mouseDown" || payload.type === "mouseUp") {
    updateMouseButton(payload.button, payload.type === "mouseDown");
  }
  if (payload.type === "reset") {
    inputState.reset();
    renderInput();
  }
});

loadSettings().catch(error => showStatus(`读取设置失败：${error.message}`));
