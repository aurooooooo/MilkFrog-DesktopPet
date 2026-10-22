// Build-time only. FFmpeg is not bundled or started by the pet at runtime.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const reference = path.resolve(process.argv[2] || path.join(root, "..", "naiwa-pet", "naiwa"));
const output = path.join(root, "assets", "runtime");
fs.mkdirSync(output, { recursive: true });
const ffmpeg = args => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { windowsHide: true, stdio: "inherit" });
const layers = {
  base: "seven-key/base.png", mouse: "seven-key/mouse.png",
  "mouse-arm": "seven-key/mouse-arm-balanced.png", "keyboard-arm": "seven-key/keyboard-arm-balanced.png",
  "eye-patch": "accessory_eye_patch.png", angry: "accessory_angry.png", meow: "accessory_meow.png",
  preview: "seven-key/preview.png"
};
for (const [name, file] of Object.entries(layers)) {
  ffmpeg(["-i", path.join(root,"assets",file), "-vf", "scale=960:640:flags=lanczos", "-c:v", "libwebp", "-lossless", "1", "-compression_level", "6", path.join(output,`${name}.webp`)]);
}
for (const [name, file] of [["keyboard-tap", "keyboard_tap.mp4"], ["click-laugh", "laugh.mp3"]]) {
  ffmpeg(["-i",path.join(root,"assets","audio",file),"-vn","-c:a","libopus","-b:a","48k","-ac","1",path.join(output,`${name}.ogg`)]);
}
for (const file of ["gagadilaxia.mp3","gajiaosei.mp3","ganbadie.mp3","andi.mp3"]) {
  fs.copyFileSync(path.join(reference,"voice",file),path.join(output,file));
}
ffmpeg(["-i",path.join(reference,"laugh.mp4"),"-i",path.join(reference,"laugh.m4a"),
  "-map","0:v:0","-map","1:a:0",
  "-vf","format=rgba,colorkey=0x77fd9a:0.12:0.04,despill=type=green:mix=1,crop=680:880:580:152,scale=448:576:flags=lanczos,setsar=1,fps=24,format=yuva420p",
  "-c:v","libvpx-vp9","-b:v","0","-crf","36","-row-mt","1","-cpu-used","4","-auto-alt-ref","0",
  "-c:a","libopus","-b:a","48k","-ac","1","-shortest","-map_metadata","-1",path.join(output,"laugh.webm")]);
console.log("Prepared compact runtime images, voices, and transparent laugh video:", output);
