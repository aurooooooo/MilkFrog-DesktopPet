const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { KEY_BINDINGS, createInputState } = require("../src/input-state");
const { PET_RIG, keyTarget, mouseTarget, armPose } = require("../src/rig");
const input = createInputState();
for (const vk of [66, 13, 161, 163, "__proto__"]) assert.equal(input.key(vk, true), false);
assert.deepEqual(Object.values(KEY_BINDINGS).map(b => b.code).sort(), ["KeyA","KeyW","KeyS","KeyD","ShiftLeft","ControlLeft","Space"].sort());
for (const vk of Object.keys(KEY_BINDINGS).map(Number)) {
  assert.equal(input.key(vk, true), true);
  assert.equal(input.key(vk, true), false, "Duplicate local/global events do not retrigger");
  assert.deepEqual(input.snapshot().keys, [vk]);
  input.key(vk, false);
}
input.key(87, true); input.key(32, true); input.key(160, true); input.mouse(1, true);
assert.deepEqual(input.snapshot().keys, [87,32,160]);
assert.deepEqual(input.snapshot().buttons, [1], "Mouse and keyboard stay active independently");
input.key(160, false); input.key(13, false); input.mouse(1, false);
assert.deepEqual(input.snapshot().keys, [87,32], "Releases preserve other held keys");
assert.equal(input.cursor(-2,3), true);
assert.deepEqual(input.snapshot().cursor, {x:-1,y:1});
assert.equal(input.cursor(-2,3), false, "Stationary cursor does not schedule animation");
assert.equal(input.cursor(NaN,0), false);
const copy = input.snapshot(); copy.keys.length=0; copy.cursor.x=9;
assert.equal(input.snapshot().keys.length,2);
assert.equal(input.snapshot().cursor.x,-1);
input.reset();
assert.deepEqual(input.snapshot(), {keys:[],buttons:[],cursor:{x:0,y:0}});
assert.ok(keyTarget(32)[1] < keyTarget(87)[1], "Space nearest frog, W nearest viewer");
assert.ok(keyTarget(68)[0]<keyTarget(83)[0] && keyTarget(83)[0]<keyTarget(65)[0], "Physical rotation, not mirrored text");
const targets=Object.keys(KEY_BINDINGS).map(keyTarget);
assert.equal(new Set(targets.map(p=>p.join(","))).size,7);
const mousePositions = [];
for (const x of [-1,0,1]) for (const y of [-1,0,1]) for (const pressed of [false,true]) {
  const target = mouseTarget({x,y},pressed);
  mousePositions.push(target);
  const center = target.map((n,i)=>n+PET_RIG.mouseFoot.offset[i]);
  for(let i=0;i<PET_RIG.mousePad.length;i++){
    const a=PET_RIG.mousePad[i], b=PET_RIG.mousePad[(i+1)%PET_RIG.mousePad.length];
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const nx=(a[1]-b[1])/length, ny=(b[0]-a[0])/length;
    const margin=Math.hypot(nx*PET_RIG.mouseFoot.radius[0],ny*PET_RIG.mouseFoot.radius[1]);
    assert.ok((center[0]-a[0])*nx+(center[1]-a[1])*ny>=margin-0.01,"Mouse contact stays inside the pad");
  }
}
assert.ok(Math.max(...mousePositions.map(p=>p[0]))-Math.min(...mousePositions.map(p=>p[0]))>140,"Horizontal travel substantially exceeds previous 72px span");
assert.ok(Math.max(...mousePositions.map(p=>p[1]))-Math.min(...mousePositions.map(p=>p[1]))>60,"Vertical travel exceeds previous 44px span");
assert.deepEqual(PET_RIG.mouseRange,[100,44],"Keep the already accepted movement range");
assert.ok(mouseTarget({x:0.5,y:0})[0]<mouseTarget({x:-0.5,y:0})[0],"Screen-right input moves the frog's mouse left in the viewer's image");
assert.ok(mouseTarget({x:0,y:0.5})[1]<mouseTarget({x:0,y:-0.5})[1],"Screen-down input moves the frog's mouse up in the viewer's image");
for (const arm of [PET_RIG.mouseArm,PET_RIG.keyboardArm]) for (const target of [arm.wrist,...targets,[0,0],arm.shoulder]) {
  const pose=armPose(arm,target);
  assert.deepEqual(pose.shoulder,arm.shoulder.map((value,axis)=>value+arm.rootShift[axis]));
  assert.deepEqual(pose.wrist,target);
  assert.ok(Object.values(pose).flat().every(Number.isFinite));
}
if(process.platform==="win32"){
  const {spawnSync}=require("node:child_process");
  const helperPath=path.join(__dirname,"../build/native/MilkFrog.Input.exe");
  const parsed=spawnSync(helperPath,["--self-test"],{encoding:"utf8",windowsHide:true});
  assert.equal(parsed.status,0,parsed.stderr||String(parsed.error));
  const helper=JSON.parse(parsed.stdout);
  assert.deepEqual(helper.keys,Object.keys(KEY_BINDINGS).map(Number));
  assert.deepEqual(helper.buttons,[1,2]);
  assert.equal(helper.pollMilliseconds,28);
}
console.log("Passed: seven keys, holds, combinations, mouse independence, keyboard direction, anchored arm geometry and compiled Windows helper configuration.");
