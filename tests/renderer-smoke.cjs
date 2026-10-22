const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
app.setPath("userData", path.join(root, ".test-runtime"));
app.disableHardwareAcceleration();
let settings = { scale: 1, muted: true, accessory: null };
ipcMain.handle("settings:get", () => settings);
ipcMain.handle("settings:set", (event, patch) => {
  settings = { ...settings, ...patch };
  event.sender.send("settings:changed", settings);
  return settings;
});
const output = path.join(root, ".test-artifacts", "seven-key");
fs.mkdirSync(output, { recursive: true });

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 960, height: 640, frame: false, show: false, transparent: true,
    webPreferences: { preload: path.join(root, "src/preload.js"), contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false }
  });
  const errors = [];
  win.webContents.setAudioMuted(true); // Verify actual decoders without playing sounds into the user's desktop.
  win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) errors.push(message); });
  const evaluate = source => win.webContents.executeJavaScript(source);
  const waitFor = predicate => evaluate(`new Promise((resolve,reject)=>{
    const start=performance.now();function check(){if(${predicate})return resolve(true);
      if(performance.now()-start>8000)return reject(new Error('Condition timed out'));
      setTimeout(check,25);}check();})`);
  const settle = () => evaluate(`new Promise((resolve,reject)=>{
    const start=performance.now();
    function check(){
      if(scene.dataset.loadError)return reject(new Error(scene.dataset.loadError));
      if(scene.dataset.ready==='true'&&!rig.pending)return resolve(true);
      if(performance.now()-start>8000)return reject(new Error('Renderer did not settle'));
      setTimeout(check,25);
    }check();
  })`);
  const capture = async name => fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
  const send = payload => win.webContents.send("global-input", payload);
  const action = payload => win.webContents.send("pet:action", payload);
  try {
    await win.loadFile(path.join(root, "src/index.html"));
    await settle();
    await evaluate("document.body.style.background='#e3eaf0'");
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await capture("idle-light.png");
    for (const [name,x,y] of [["mouseArm",655,340],["keyboardArm",1131,386]]) {
      const opacity = await evaluate(`(()=>{const layer=rig.images.${name}.armLayer;return layer.getContext('2d').getImageData(Math.round(${x}*layer.width/PET_RIG.width),Math.round(${y}*layer.height/PET_RIG.height),1,1).data[3]})()`);
      assert.ok(opacity >= 250, `${name} shoulder should be solid, got alpha ${opacity}`);
    }
    const idle = await evaluate("JSON.stringify(rig.pose)");
    assert.deepEqual(await evaluate("Object.keys(rig.images).sort()"),["base","keyboardArm","mouse","mouseArm"],"Unused accessories are not decoded at startup");
    assert.equal(await evaluate("document.getElementById('sceneFallback').hasAttribute('src')"),false);
    assert.equal(await evaluate("media.video.hasAttribute('src') || media.effectAudio.hasAttribute('src') || media.keyboardAudio.hasAttribute('src')"),false,"Media remains unloaded at startup");
    send({type:"cursor",point:{x:1440,y:810},displayBounds:{x:0,y:0,width:1920,height:1080}});
    await settle();
    const physicalPose = await evaluate("rig.pose.mouse.slice()");
    const mouseHome = await evaluate("PET_RIG.mouseArm.home.slice()");
    assert.ok(physicalPose[0]<mouseHome[0] && physicalPose[1]<mouseHome[1],"Both mouse axes should be inverted for the frog-facing perspective");
    await capture("mouse-physical-direction.png");
    send({type:"reset"});
    await settle();
    for (const vk of [87, 160, 162]) send({ type: "keyDown", vk });
    send({ type: "mouseDown", button: 1 });
    send({ type: "cursor", point: { x: -1800, y: 1000 }, displayBounds: { x: -1920, y: 0, width: 1920, height: 1080 } });
    await settle();
    const combo = await evaluate("({keys:rig.state.keys,buttons:rig.state.buttons,pose:rig.pose})");
    assert.deepEqual(combo.keys, [87, 160, 162]);
    assert.deepEqual(combo.buttons, [1]);
    assert.notEqual(JSON.stringify(combo.pose), idle);
    await capture("combo-mouse.png");
    for (const [name,x,y] of [["mouse-left-top",-1920,0],["mouse-right-bottom",0,1080]]) {
      send({ type:"cursor", point:{x,y}, displayBounds:{x:-1920,y:0,width:1920,height:1080} });
      await settle();
      await capture(`${name}.png`);
    }
    send({ type: "keyUp", vk: 162 });
    await settle();
    assert.deepEqual(await evaluate("rig.state.keys"), [87, 160]);
    send({ type: "reset" });
    await settle();
    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{code:'ShiftRight'}))");
    assert.deepEqual(await evaluate("rig.state.keys"), []);
    for (const vk of [65, 87, 83, 68, 160, 162, 32]) {
      send({ type: "keyDown", vk });
      await settle();
      assert.ok((await evaluate("rig.pose.keyboard")).every(Number.isFinite));
      await capture(`key-${vk}.png`);
      send({ type: "keyUp", vk });
    }
    await settle();
    action({type:"accessory",id:"eyePatch"});
    await waitFor("rig.accessory==='eyePatch'");
    await settle();
    await capture("eye-patch.png");
    action({type:"clear"});
    await waitFor("rig.accessory===null");
    await settle();
    await evaluate("document.body.style.background='#20262b'");
    await capture("idle-dark.png");
    assert.equal(await evaluate("document.querySelector('nav')"),null,"No HTML popup can be clipped by the pet window");
    await evaluate("window.petApp.setSettings({muted:false,gameMode:true})");
    await waitFor("media.muted===false");
    assert.equal(await evaluate("audioState.gameMode"),true,"Accessory voices also play in game mode");
    for (const [index,id,file] of [[0,"eyePatch","gagadilaxia.mp3"],[1,"angry","gajiaosei.mp3"],[2,"meow","ganbadie.mp3"],[3,"eyePatch","andi.mp3"]]) {
      await evaluate("window.savedRandom=Math.random;Math.random=()=>"+((index+0.1)/4)+";undefined");
      action({type:"accessory",id});
      await waitFor("media.effectAudio.getAttribute('src')==='../assets/runtime/"+file+"'");
      await evaluate("Math.random=window.savedRandom;undefined");
      await waitFor("rig.accessory==='"+id+"'");
      assert.equal(await evaluate("Object.keys(rig.images).length"),5);
    }
    await evaluate("window.petApp.setSettings({muted:true})");
    await waitFor("media.muted===true");
    action({type:"accessory",id:"angry"});
    await waitFor("rig.accessory==='angry'");
    assert.equal(await evaluate("media.effectAudio.hasAttribute('src')"),false);
    action({type:"clear"});
    await waitFor("rig.accessory===null");
    assert.equal(await evaluate("Object.keys(rig.images).length"),4);
    action("laugh");
    await waitFor("media.laughing && media.video.readyState>=2 && !media.video.hidden");
    assert.deepEqual(await evaluate("[media.video.videoWidth,media.video.videoHeight]"),[448,576]);
    await evaluate("media.video.currentTime=3");
    await waitFor("!media.video.seeking && media.video.currentTime>=3");
    await capture("belly-laugh.png");
    await evaluate("media.video.currentTime=media.video.duration-0.15");
    await waitFor("media.laughing===false");
    await settle();
    assert.equal(await evaluate("media.video.hasAttribute('src')"),false);
    assert.equal(await evaluate("rig.suspended"),false);
    action("laugh");
    await waitFor("media.laughing===true");
    action("stop");
    await waitFor("media.laughing===false");
    await settle();
    for (const [width,height] of [[144,96],[336,224],[624,416],[1296,864]]) {
      win.setContentSize(width,height);
      await waitFor("innerWidth==="+width+" && innerHeight==="+height);
      await waitFor("scene.width===Math.min(PET_RIG.width,Math.round(innerWidth*Math.min(devicePixelRatio||1,2)))");
      await settle();
      assert.ok(await evaluate("rig.ctx.getImageData(Math.round(scene.width*.55),Math.round(scene.height*.2),1,1).data[3]>240"),"Frog remains rendered at "+width+"x"+height);
      const data = await evaluate("(()=>{const c=document.createElement('canvas');c.width=scene.width;c.height=scene.height;const ctx=c.getContext('2d');ctx.fillStyle='#20262b';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(scene,0,0);return c.toDataURL('image/png').split(',')[1]})()");
      fs.writeFileSync(path.join(output,"size-"+width+".png"),Buffer.from(data,"base64"));
    }
    assert.deepEqual(errors, []);
    console.log("Electron smoke passed: seven keys, combinations, lazy media, four random voices, transparent laugh playback/end/cancel, native menu actions, 15%-135% rendering, no renderer errors.");
    console.log(`Screenshots: ${output}`);
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ passed: true, rendererErrors: errors, screenshots: fs.readdirSync(output).filter(name => name.endsWith(".png")) }, null, 2));
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ passed: false, error: error.stack }, null, 2));
    win.destroy();
    app.exit(1);
  }
});
