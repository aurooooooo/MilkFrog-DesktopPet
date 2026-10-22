// Build-time notice collection from the exact Cargo.lock dependency graph.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const metadata = JSON.parse(execFileSync('cargo', ['metadata','--offline','--format-version','1','--manifest-path',path.join(root,'rust/Cargo.toml')], { encoding:'utf8',windowsHide:true }));
const sections = ['MilkFrog DesktopPet Rust 0.4.0\nProject license: MIT (see LICENSE in the source repository).\nMedia attribution: rust/assets/SOURCES.md and assets/runtime/SOURCES.md.\n\nThird-party Rust dependency licenses follow (including build-time dependencies).'];
for (const item of metadata.packages.filter(p=>p.name!=='milkfrog').sort((a,b)=>a.name.localeCompare(b.name))) {
  const directory = path.dirname(item.manifest_path);
  const files = fs.readdirSync(directory).filter(name=>/^(LICENSE|LICENCE|COPYING|NOTICE)([-_.].*)?$/i.test(name)&&fs.statSync(path.join(directory,name)).isFile());
  sections.push(`\n${'='.repeat(72)}\n${item.name} ${item.version}\nLicense: ${item.license}\nSource: ${item.repository||item.source||''}\n` + files.map(name=>`${name}\n${fs.readFileSync(path.join(directory,name),'utf8')}`).join('\n'));
}
fs.writeFileSync(path.join(root,'rust/THIRD-PARTY-NOTICES.txt'),sections.join('\n'));
