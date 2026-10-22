use std::{env, fs, path::PathBuf, process::Command};
fn main() {
    println!("cargo:rerun-if-changed=../assets/icon.ico");
    println!("cargo:rerun-if-changed=app.manifest");
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let kits = PathBuf::from(env::var_os("ProgramFiles(x86)").unwrap()).join("Windows Kits/10/bin");
    let mut versions: Vec<_> = fs::read_dir(kits)
        .unwrap()
        .flatten()
        .map(|e| e.path().join("x64/rc.exe"))
        .filter(|p| p.exists())
        .collect();
    versions.sort();
    let rc = versions.pop().expect("Windows SDK rc.exe is required");
    let mut text = format!(
        "1 ICON \"{}\"\n1 24 \"{}\"\n",
        root.join("../assets/icon.ico").display(),
        root.join("app.manifest").display()
    )
    .replace('\\', "/");
    text.push_str(
        r#"
1 VERSIONINFO
FILEVERSION 0,4,0,0
PRODUCTVERSION 0,4,0,0
FILEFLAGSMASK 0x3fL
FILEFLAGS 0x0L
FILEOS 0x40004L
FILETYPE 0x1L
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904b0"
    BEGIN
      VALUE "FileDescription", "MilkFrog Native Desktop Pet"
      VALUE "FileVersion", "0.4.0"
      VALUE "ProductName", "MilkFrog DesktopPet Rust"
      VALUE "ProductVersion", "0.4.0"
      VALUE "OriginalFilename", "MilkFrog-0.4.0-rust-x64.exe"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x409, 1200
  END
END
"#,
    );
    fs::write(out.join("pet.rc"), text).unwrap();
    let res = out.join("pet.res");
    assert!(Command::new(rc)
        .arg("/nologo")
        .arg("/fo")
        .arg(&res)
        .arg(out.join("pet.rc"))
        .status()
        .unwrap()
        .success());
    println!("cargo:rustc-link-arg={}", res.display());
}
