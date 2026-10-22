const assert = require("node:assert/strict");
const { LOGIN_NAME, loginOptions, getAutoStart, setAutoStart } = require("../src/startup");
const oldPortable = process.env.PORTABLE_EXECUTABLE_FILE;
let entry, blocked = false;
const app = {
  isPackaged: true,
  getAppPath: () => "D:\\Dev Space\\MilkFrog",
  setLoginItemSettings: value => { entry = value; },
  getLoginItemSettings: ({path,args}) => ({
    openAtLogin: Boolean(entry && entry.openAtLogin && path === entry.path && JSON.stringify(args) === JSON.stringify(entry.args)),
    executableWillLaunchAtLogin: !blocked
  })
};
try {
  delete process.env.PORTABLE_EXECUTABLE_FILE;
  assert.equal(loginOptions(app).path,process.execPath);
  assert.equal(setAutoStart(app,true),true);
  assert.equal(entry.name,LOGIN_NAME);
  assert.deepEqual(entry.args,[]);
  blocked = true;
  assert.equal(getAutoStart(app),false,"Respect a startup item disabled by Windows");
  blocked = false;
  assert.equal(setAutoStart(app,false),false);
  process.env.PORTABLE_EXECUTABLE_FILE="D:\\Pet Folder\\MilkFrog-portable.exe";
  assert.equal(setAutoStart(app,true),true);
  assert.equal(entry.path,process.env.PORTABLE_EXECUTABLE_FILE,"Portable startup must use the persistent outer EXE");
  app.isPackaged=false;
  assert.equal(loginOptions(app).path,process.execPath);
  assert.deepEqual(loginOptions(app).args,['"D:\\Dev Space\\MilkFrog"']);
  console.log("Passed: installed, portable and development startup paths; enable/disable; Windows-disabled state. No registry changes performed.");
} finally {
  if (oldPortable === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE;
  else process.env.PORTABLE_EXECUTABLE_FILE=oldPortable;
}
