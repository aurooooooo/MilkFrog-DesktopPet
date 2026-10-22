// FFmpeg and Electron are build tools only; neither ships in the Rust app.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const input = path.join(root, 'assets/runtime');
const output = path.join(root, 'rust/assets');
fs.mkdirSync(output, { recursive: true });
function ffmpeg(args) {
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y', ...args], { windowsHide: true, stdio: 'inherit' });
}
for (const name of ['base','mouse','mouse-arm','keyboard-arm','eye-patch','angry','meow']) {
  ffmpeg(['-i',path.join(input,`${name}.webp`),path.join(output,`${name}.png`)]);
}
for (const [name,ext,volume] of [
  ['keyboard-tap','ogg',0.38],['click-laugh','ogg',0.62],
  ...['gagadilaxia','gajiaosei','ganbadie','andi'].map(name=>[name,'mp3',0.7]),
  ['laugh','webm',0.7]
]) {
  ffmpeg(['-i',path.join(input,`${name}.${ext}`),'-vn','-ac','1','-ar','24000','-af',`volume=${volume}`,
    '-c:a','pcm_s16le',path.join(output,`${name}.wav`)]);
}
// H.264 stores color and grayscale alpha side by side. Windows decodes frames
// on demand; Rust combines them into premultiplied RGBA without a browser.
ffmpeg(['-c:v','libvpx-vp9','-i',path.join(input,'laugh.webm'),'-filter_complex',
  '[0:v]split[c][a];[c]format=rgb24[clr];[a]alphaextract,format=rgb24[alp];[clr][alp]hstack=inputs=2,format=yuv420p[v]',
  '-map','[v]','-an','-c:v','libx264','-preset','slow','-crf','18','-movflags','+faststart',
  '-map_metadata','-1',path.join(output,'laugh-packed.mp4')]);
execFileSync(path.join(root,'node_modules/electron/dist/electron.exe'), [path.join(__dirname,'export-rust-art.cjs')],
  { cwd: root, windowsHide: true, stdio: 'inherit', timeout: 30000 });
console.log('Prepared native assets:', output);
