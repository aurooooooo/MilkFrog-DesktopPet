const KEY_BINDINGS = Object.freeze({
  65: { code: "KeyA" },
  87: { code: "KeyW" },
  83: { code: "KeyS" },
  68: { code: "KeyD" },
  160: { code: "ShiftLeft" },
  162: { code: "ControlLeft" },
  32: { code: "Space" }
});

function createInputState() {
  const keys = new Set();
  const buttons = new Set();
  let cursor = { x: 0, y: 0 };

  function setHeld(held, id, down) {
    if (held.has(id) === down) return false;
    if (down) held.add(id);
    else held.delete(id);
    return true;
  }

  return {
    key(vk, down) {
      return Object.hasOwn(KEY_BINDINGS, vk) ? setHeld(keys, Number(vk), down) : false;
    },
    mouse(button, down) {
      if (button !== 1 && button !== 2) return false;
      return setHeld(buttons, button, down);
    },
    cursor(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      const next = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
      if (next.x === cursor.x && next.y === cursor.y) return false;
      cursor = next;
      return true;
    },
    snapshot() {
      return { keys: Array.from(keys), buttons: Array.from(buttons), cursor: { ...cursor } };
    },
    reset() {
      keys.clear();
      buttons.clear();
      cursor = { x: 0, y: 0 };
    }
  };
}

if (typeof module !== "undefined") module.exports = { KEY_BINDINGS, createInputState };
