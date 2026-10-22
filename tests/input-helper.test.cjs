const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const helper = spawn(path.join(__dirname,"../build/native/MilkFrog.Input.exe"),[],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
helper.stdout.resume();
helper.stderr.resume();
helper.on("error",error=>{ console.error(error); process.exitCode=1; });
const timeout=setTimeout(()=>{helper.kill();throw new Error("Helper did not exit after its parent pipe closed");},4000);
setTimeout(()=>{
  assert.equal(helper.exitCode,null,"Helper stays alive while the app's input pipe is open");
  helper.stdin.end();
},500);
helper.on("exit",code=>{
  clearTimeout(timeout);
  assert.equal(code,0);
  console.log("Passed: standalone input helper runs and exits when its parent pipe closes.");
});
