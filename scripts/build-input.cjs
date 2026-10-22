const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.join(__dirname, "..");
if (process.platform !== "win32") throw new Error("Build the Windows input helper on Windows.");
const compiler = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
const output = path.join(root, "build", "native", "MilkFrog.Input.exe");
fs.mkdirSync(path.dirname(output), { recursive: true });
execFileSync(compiler, ["/nologo", "/optimize+", "/target:exe", "/platform:x64", `/out:${output}`,
  path.join(root, "native", "InputMonitor.cs")], { stdio: "inherit", windowsHide: true });
console.log(`Built ${output}`);
