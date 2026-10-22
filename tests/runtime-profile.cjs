// Measures this app's process working sets; it never opens or inspects a game process.
const { app, BrowserWindow } = require("electron");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.join(__dirname, "..");
const label = process.argv[2] || "current";
if (label.includes("rust-comparison")) app.commandLine.appendSwitch("force-device-scale-factor", "1");
const helpers = [];
const spawn = childProcess.spawn;
childProcess.spawn = function (file, ...args) {
  const helper = spawn.call(this, file, ...args);
  helpers.push(helper);
  return helper;
};
app.setPath("userData", path.join(root, ".test-runtime", `profile-${label}`));
app.on("browser-window-created", (_event, window) => {
  window.hide();
  // Keep hidden test rendering comparable to a visible desktop window.
  window.webContents.setBackgroundThrottling(false);
  window.webContents.setAudioMuted(true);
  const setIgnoreMouseEvents = window.setIgnoreMouseEvents.bind(window);
  window.setIgnoreMouseEvents = enabled => { window.testIgnoresMouse = enabled; setIgnoreMouseEvents(enabled); };
  window.show = () => {};
  window.showInactive = () => {};
});
require("../src/main");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    await delay(8000);
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("App window not created");
    await window.webContents.executeJavaScript("window.petApp.setSettings({scale:0.65,muted:false})");
    await window.webContents.executeJavaScript("window.petApp.setSettings({gameMode:true})");
    assert.equal(window.isFocusable(),false);
    assert.equal(window.testIgnoresMouse,true);
    await window.webContents.executeJavaScript("window.petApp.setSettings({gameMode:false})");
    assert.equal(window.isFocusable(),true);
    assert.equal(window.testIgnoresMouse,false);
    if (label.includes("rust-comparison")) {
      window.setBounds({x:100,y:100,width:624,height:416});
      await delay(750);
      await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
        const start=performance.now(); function check(){
          if(scene.width===624&&scene.height===416)return resolve(true);
          if(performance.now()-start>5000)return reject(new Error('Expected 624x416 comparison canvas'));
          setTimeout(check,25);
        } check();})`);
    }
    const sample = () => app.getAppMetrics().map(p => ({ type: p.type, pid: p.pid,
      workingSetMiB: p.memory.workingSetSize / 1024,
      privateMiB: p.memory.privateBytes / 1024 }));
    const idle = sample();
    const pixels = await window.webContents.executeJavaScript(`({
      canvas: [scene.width,scene.height],
      images: Object.fromEntries(Object.entries(rig.images).map(([k,v])=>[k,[v.width,v.height]])),
      ready:scene.dataset.ready
    })`);
    let step = 0;
    const movement = setInterval(() => {
      step++;
      window.webContents.send("global-input", {type:"cursor",point:{x:960+800*Math.sin(step/12),y:540+450*Math.cos(step/12)},displayBounds:{x:0,y:0,width:1920,height:1080}});
      if (step%12===0) window.webContents.send("global-input", {type:"keyDown",vk:87});
      if (step%12===6) window.webContents.send("global-input", {type:"keyUp",vk:87});
    }, 33);
    await delay(6000);
    clearInterval(movement);
    const moving = sample();
    window.webContents.send("global-input",{type:"reset"});
    await window.webContents.executeJavaScript("media.toggleLaugh();undefined");
    await delay(2500);
    const laughing = sample();
    await window.webContents.executeJavaScript("media.stopAll();undefined");
    await delay(1500);
    const afterMedia = sample();
    const helperIds = helpers.filter(p=>p.pid && p.exitCode === null).map(p=>p.pid);
    let helperMemory = [];
    if (helperIds.length) {
      const output = childProcess.execFileSync("powershell.exe", ["-NoProfile", "-Command",
        `Get-Process -Id ${helperIds.join(",")} | Select-Object Id,ProcessName,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`],
      {encoding:"utf8",windowsHide:true});
      helperMemory = JSON.parse(output);
      if (!Array.isArray(helperMemory)) helperMemory = [helperMemory];
    }
    const result = {label,at:new Date().toISOString(),electron:process.versions.electron,bounds:window.getBounds(),pixels,idle,moving,laughing,afterMedia,helpers:helperMemory};
    fs.mkdirSync(path.join(root,".test-artifacts"),{recursive:true});
    fs.writeFileSync(path.join(root,".test-artifacts",`performance-${label}.json`),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
    app.quit();
  } catch (error) { console.error(error); app.exit(1); }
});
