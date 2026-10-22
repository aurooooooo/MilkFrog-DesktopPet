const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const handlers = new Map(), messages = [], popups = [];
let trayItems;
class Window extends EventEmitter {
  constructor(options) {
    super(); this.bounds={x:20,y:20,width:options.width,height:options.height}; this.visible=true;
    this.webContents=new EventEmitter();
    this.webContents.send=(...args)=>messages.push(args);
    this.webContents.isDestroyed=()=>false;
  }
  isDestroyed(){return false;} isVisible(){return this.visible;}
  getBounds(){return this.bounds;} setBounds(bounds){this.bounds=bounds;}
  setAlwaysOnTop(){} setFocusable(){} setIgnoreMouseEvents(){} setSkipTaskbar(){}
  removeMenu(){} loadFile(){} hide(){this.visible=false;}
}
const electron = {
  app:{setName(){},disableHardwareAcceleration(){},commandLine:{appendSwitch(){}},requestSingleInstanceLock:()=>false,
    quit(){},on(){},getPath:()=>"test-settings",getAppPath:()=>"test-app",getLoginItemSettings:()=>({openAtLogin:false}),isPackaged:false},
  BrowserWindow:Window, ipcMain:{handle:(key,fn)=>handlers.set(key,fn),on:(key,fn)=>handlers.set(key,fn)},
  screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1080}}),
    getDisplayMatching:()=>({workArea:{x:0,y:0,width:1920,height:1080}})},
  Menu:{buildFromTemplate:items=>({items,popup:options=>popups.push({items,options})})},
  Tray:class{},dialog:{showErrorBox(){}}
};
const context = vm.createContext({
  require:name=>name==="electron"?electron:name==="fs"?{readFileSync(){throw Error("First run");},mkdirSync(){},writeFileSync(){}}:
    name.startsWith("./")?require(path.join(__dirname,"../src",name)):require(name),
  process:{platform:"win32",env:{},execPath:process.execPath}, __dirname:path.join(__dirname,"../src"),
  console,setInterval,clearInterval,setTimeout, testTray:{setContextMenu:menu=>{trayItems=menu.items;}}
});
vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/main.js"),"utf8"),context);
const run=code=>vm.runInContext(code,context);
run("createWindow();tray=testTray;updateTrayMenu()");
assert.deepEqual(Array.from(run("petMenuItems().map(item=>item.label)")),["装扮","动作","大小（65%）"]);
run("applyScale(0.01)");
assert.equal(run("settings.scale"),0.15);
assert.equal(run("win.getBounds().width"),144);
assert.equal(run("win.getBounds().height"),96);
assert.equal(run("petMenuItems()[2].submenu[0].enabled"),false);
run("applyScale(9)");
assert.equal(run("settings.scale"),1.35,"Keep the accepted maximum");
assert.equal(run("win.getBounds().width"),1296);
assert.equal(run("petMenuItems()[2].submenu[1].enabled"),false);
for (const scale of [0.15,0.35,0.65,1.35]) {
  run(`applyScale(${scale});win.webContents.emit('context-menu',null,{x:10,y:10})`);
  assert.equal(popups.at(-1).items.length,3);
  assert.equal(popups.at(-1).options.window,run("win"),"Use the native menu popup, independent of pet bounds");
}
run("applyScale(.35);petMenuItems()[2].submenu[0].click()");
assert.equal(run("settings.scale"),0.30);
run("petMenuItems()[0].submenu[0].click()");
assert.equal(messages.at(-1)[1].id,"eyePatch");
handlers.get("pet:laughing")({},true);
assert.equal(run("petMenuItems()[1].submenu[0].label"),"停止大笑");
for(const label of ["隐藏奶蛙","静音","开机自启动","游戏模式（鼠标穿透 / 不抢焦点）","退出"])
  assert.ok(trayItems.some(item=>item.label===label),`${label} is available in tray`);
trayItems.find(item=>item.label==="隐藏奶蛙").click();
assert.equal(run("win.isVisible()"),false);
assert.equal(messages.some(message=>message[0]==="pet:action" && message[1]==="stop"),true);
console.log("Passed: 15%-135% size limits, 5% adjustments, native three-group context menu at all sizes, tray controls and action routing.");
