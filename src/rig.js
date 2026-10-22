const PET_RIG = {
  width: 1536, height: 1024,
  mouseArm: { shoulder: [635, 350], elbow: [555, 450], wrist: [455, 515], home: [455, 515], offset: [0, 0], scale: 1, rootShift: [-20, 0] },
  keyboardArm: { shoulder: [1075, 325], elbow: [1190, 465], wrist: [1040, 615], home: [1080, 565], offset: [228.5, 98.5], scale: 0.82, rootShift: [-24, 0] },
  mouseRange: [100, 44],
  mousePad: [[300, 523], [715, 582], [550, 819], [105, 742]],
  mouseFoot: { offset: [-7, 215], radius: [92, 27] },
  keys: {
    32: [[868, 589], [1168, 629], [1164, 666], [849, 629]],
    162: [[1196, 639], [1289, 655], [1282, 692], [1183, 677]],
    68: [[838, 645], [924, 658], [919, 694], [818, 683]],
    83: [[956, 663], [1036, 677], [1032, 718], [937, 703]],
    65: [[1069, 682], [1156, 694], [1146, 734], [1052, 720]],
    160: [[1184, 701], [1282, 716], [1273, 758], [1169, 744]],
    87: [[958, 729], [1047, 745], [1036, 786], [946, 769]]
  }
};

function mouseTarget(cursor, pressed = false) {
  const foot = PET_RIG.mouseFoot;
  // The frog faces the viewer, so its physical mouse axes run opposite to screen cursor axes.
  const center = PET_RIG.mouseArm.home.map((n, i) => n + foot.offset[i] - cursor[i === 0 ? "x" : "y"] * PET_RIG.mouseRange[i] + (i === 1 && pressed ? 5 : 0));
  // Keep the mouse's contact ellipse inside the perspective mouse pad, including at screen corners.
  for (let pass = 0; pass < 6; pass++) for (let i = 0; i < PET_RIG.mousePad.length; i++) {
    const a = PET_RIG.mousePad[i], b = PET_RIG.mousePad[(i + 1) % PET_RIG.mousePad.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = (a[1] - b[1]) / length, ny = (b[0] - a[0]) / length;
    const margin = Math.hypot(nx * foot.radius[0], ny * foot.radius[1]) + 4;
    const missing = margin - ((center[0] - a[0]) * nx + (center[1] - a[1]) * ny);
    if (missing > 0) { center[0] += nx * missing; center[1] += ny * missing; }
  }
  return center.map((n, i) => n - foot.offset[i]);
}

function keyTarget(vk) {
  const points = PET_RIG.keys[vk];
  if (!points) return PET_RIG.keyboardArm.home.slice();
  return [points.reduce((n, p) => n + p[0], 0) / 4, points.reduce((n, p) => n + p[1], 0) / 4 - 65];
}

function armPose(arm, wrist) {
  // ponytail: preserve the painted elbow with soft 2D stretch; use authored skeletal art if rigid 3D articulation is needed.
  return {
    shoulder: arm.shoulder.map((value, axis) => value + arm.rootShift[axis]),
    elbow: arm.elbow.map((value, axis) => value + arm.rootShift[axis] * 0.55 + (wrist[axis] - arm.wrist[axis]) * 0.45),
    wrist: wrist.slice()
  };
}

function paintArm(destination, image, arm, targetWrist) {
  const width = destination.canvas.width, height = destination.canvas.height;
  if (!image.armLayer) {
    image.armLayer = document.createElement("canvas");
  }
  if (image.armLayer.width !== width || image.armLayer.height !== height) {
    image.armLayer.width = width;
    image.armLayer.height = height;
  }
  const ctx = image.armLayer.getContext("2d");
  ctx.setTransform(width / PET_RIG.width, 0, 0, height / PET_RIG.height, 0, 0);
  ctx.clearRect(0, 0, PET_RIG.width, PET_RIG.height);
  const scale = arm.scale || 1;
  const localWrist = targetWrist.map((n, i) => (n - arm.offset[i]) / scale);
  const pose = armPose(arm, localWrist);
  const rows = [0, arm.shoulder[1]];
  for (let y = arm.shoulder[1] + 12; y < arm.wrist[1]; y += 12) rows.push(y);
  rows.push(arm.wrist[1], PET_RIG.height);
  function warp(y) {
    const segment = y < arm.elbow[1] ? [arm.shoulder, arm.elbow, pose.shoulder, pose.elbow] : [arm.elbow, arm.wrist, pose.elbow, pose.wrist];
    let t = Math.max(0, Math.min(1, (y - segment[0][1]) / (segment[1][1] - segment[0][1])));
    t = t * t * (3 - 2 * t);
    const shift = [0, 1].map(i => (segment[2][i] - segment[0][i]) * (1 - t) + (segment[3][i] - segment[1][i]) * t);
    return [shift[0], y + shift[1]];
  }
  ctx.save();
  ctx.translate(...arm.offset);
  ctx.scale(scale, scale);
  for (let row = 0; row < rows.length - 1; row++) {
    const y0 = rows[row], y1 = rows[row + 1], height = y1 - y0;
    const top = warp(y0), bottom = warp(y1);
    const shear = (bottom[0] - top[0]) / height;
    const stretch = (bottom[1] - top[1]) / height;
    // One affine strip, with a subpixel overlap to avoid antialiased clip seams.
    const sourceHeight = Math.min(PET_RIG.height - y0, height + Math.max(0.8, PET_RIG.height / ctx.canvas.height * 1.5));
    ctx.save();
    ctx.transform(1, 0, shear, stretch, top[0] - shear * y0, top[1] - stretch * y0);
    ctx.drawImage(image, 0, y0 * image.height / PET_RIG.height, image.width, sourceHeight * image.height / PET_RIG.height,
      0, y0, PET_RIG.width, sourceHeight);
    ctx.restore();
  }
  ctx.restore();
  destination.drawImage(image.armLayer, 0, 0, PET_RIG.width, PET_RIG.height);
}

class MilkFrogRig {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => { this.resize(); this.schedule(); });
    this.state = { keys: [], buttons: [], cursor: { x: 0, y: 0 } };
    this.pose = { mouse: PET_RIG.mouseArm.home.slice(), keyboard: PET_RIG.keyboardArm.home.slice(), eyes: [0, 0] };
    this.accessory = null;
    this.pending = false;
    this.images = {};
    this.loading = {};
    this.files = { base: "runtime/base.webp", mouse: "runtime/mouse.webp", mouseArm: "runtime/mouse-arm.webp", keyboardArm: "runtime/keyboard-arm.webp", eyePatch: "runtime/eye-patch.webp", angry: "runtime/angry.webp", meow: "runtime/meow.webp" };
    this.ready = Promise.all(["base", "mouse", "mouseArm", "keyboardArm"].map(name => this.loadImage(name))).then(() => {
      canvas.dataset.ready = "true";
      const fallback = document.getElementById("sceneFallback");
      fallback.hidden = true;
      fallback.removeAttribute("src");
      this.schedule();
    }).catch(error => { canvas.dataset.loadError = error.message; console.error(error); });
  }

  resize() {
    const density = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.min(PET_RIG.width, Math.round(this.canvas.clientWidth * density));
    const height = Math.round(width * PET_RIG.height / PET_RIG.width);
    if (width === this.canvas.width && height === this.canvas.height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx.setTransform(width / PET_RIG.width, 0, 0, height / PET_RIG.height, 0, 0);
    this.shoulderCover = null;
  }

  loadImage(name) {
    if (this.images[name]) return Promise.resolve(this.images[name]);
    if (this.loading[name]) return this.loading[name];
    this.loading[name] = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = async () => {
        try {
          // Runtime assets are already 960px; original high-resolution art is kept outside the release.
          const bitmap = await createImageBitmap(image, { resizeWidth: 960, resizeHeight: 640, resizeQuality: "high" });
          image.src = "";
          this.images[name] = bitmap;
          resolve(bitmap);
        } catch (error) { reject(error); }
      };
      image.onerror = () => reject(new Error(`Unable to load pet layer: ${name}`));
      image.src = `../assets/${this.files[name]}`;
    });
    return this.loading[name];
  }


  setState(state) {
    this.state = state;
    this.canvas.dataset.keys = state.keys.join(",");
    this.canvas.dataset.buttons = state.buttons.join(",");
    this.schedule();
  }

  async setAccessory(accessory) {
    this.requestedAccessory = accessory;
    try {
      if (["eyePatch", "angry", "meow"].includes(accessory)) await this.loadImage(accessory);
      else accessory = null;
      if (this.requestedAccessory !== accessory) {
        if (accessory && accessory !== this.accessory && this.images[accessory]) {
          this.images[accessory].close();
          delete this.images[accessory];
          delete this.loading[accessory];
        }
        return;
      }
      const previous = this.accessory;
      this.accessory = accessory;
      if (previous && previous !== accessory && this.images[previous]) {
        this.images[previous].close();
        delete this.images[previous];
        delete this.loading[previous];
      }
      this.schedule();
    } catch (error) { console.error(error); }
  }

  schedule() {
    if (this.canvas.dataset.ready !== "true" || this.pending || this.suspended) return;
    this.pending = true;
    setTimeout(() => requestAnimationFrame(time => this.tick(time)), Math.max(0, 33 - (performance.now() - (this.lastTime || 0))));
  }

  tick(time) {
    this.pending = false;
    if (this.suspended) return;
    const dt = Math.min(50, Math.max(1, time - (this.lastTime ?? time - 16)));
    this.lastTime = time;
    const alpha = 1 - Math.exp(-dt / 55);
    const cursor = this.state.cursor;
    const targets = {
      mouse: mouseTarget(cursor, this.state.buttons.length > 0),
      keyboard: keyTarget(this.state.keys.at(-1)),
      eyes: [cursor.x * 8, cursor.y * 6]
    };
    let remaining = 0;
    for (const name of Object.keys(targets)) for (let i = 0; i < 2; i++) {
      const delta = targets[name][i] - this.pose[name][i];
      this.pose[name][i] += Math.abs(delta) < 0.04 ? delta : delta * alpha;
      remaining = Math.max(remaining, Math.abs(delta));
    }
    this.draw();
    if (remaining > 0.04) this.schedule();
  }

  setSuspended(suspended) {
    this.suspended = suspended;
    if (!suspended) this.schedule();
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, PET_RIG.width, PET_RIG.height);
    ctx.drawImage(this.images.base, 0, 0, PET_RIG.width, PET_RIG.height);
    for (const [x, y, rx, ry] of [[758, 165, 20, 22], [945, 190, 21, 23]]) {
      const px = x + this.pose.eyes[0], py = y + this.pose.eyes[1];
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#10180e";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(px - 6, py - 8, 4, 3, -0.3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,235,.32)";
      ctx.fill();
    }
    for (const vk of this.state.keys) {
      const points = PET_RIG.keys[vk];
      if (!points) continue;
      ctx.save();
      ctx.beginPath();
      points.forEach(([x, y], i) => i ? ctx.lineTo(x, y + 2) : ctx.moveTo(x, y + 2));
      ctx.closePath();
      ctx.fillStyle = "rgba(255,174,34,.34)";
      ctx.strokeStyle = "rgba(255,244,174,.95)";
      ctx.lineWidth = 3;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(this.pose.mouse[0] - PET_RIG.mouseArm.home[0] - 19, this.pose.mouse[1] - PET_RIG.mouseArm.home[1] + 34);
    ctx.scale(0.876, 0.924);
    ctx.drawImage(this.images.mouse, 0, 0, PET_RIG.width, PET_RIG.height);
    ctx.restore();
    paintArm(ctx, this.images.mouseArm, PET_RIG.mouseArm, this.pose.mouse);
    paintArm(ctx, this.images.keyboardArm, PET_RIG.keyboardArm, this.pose.keyboard);
    // Blend the body over solid arms; soften only the cover edge, never the arm opacity.
    if (!this.shoulderCover) {
      this.shoulderCover = document.createElement("canvas");
      this.shoulderCover.width = this.canvas.width;
      this.shoulderCover.height = this.canvas.height;
      const cover = this.shoulderCover.getContext("2d");
      cover.setTransform(this.canvas.width / PET_RIG.width, 0, 0, this.canvas.height / PET_RIG.height, 0, 0);
      cover.filter = `blur(${22 * this.canvas.width / PET_RIG.width}px)`;
      for (const points of [
        [[630, 240], [820, 240], [820, 420], [700, 420], [640, 360]],
        [[1000, 240], [1170, 240], [1120, 395], [1000, 420]]
      ]) {
        cover.beginPath();
        points.forEach(([x, y], i) => i ? cover.lineTo(x, y) : cover.moveTo(x, y));
        cover.closePath();
        cover.fill();
      }
      cover.filter = "none";
      cover.globalCompositeOperation = "source-in";
      cover.drawImage(this.images.base, 0, 0, PET_RIG.width, PET_RIG.height);
    }
    ctx.drawImage(this.shoulderCover, 0, 0, PET_RIG.width, PET_RIG.height);
    if (this.accessory && this.images[this.accessory]) {
      ctx.save();
      ctx.transform(1.26, 0.088, 0, 1, -184, -98);
      ctx.drawImage(this.images[this.accessory], 0, 0, PET_RIG.width, PET_RIG.height);
      ctx.restore();
    }
  }
}

if (typeof module !== "undefined") module.exports = { PET_RIG, keyTarget, mouseTarget, armPose };
