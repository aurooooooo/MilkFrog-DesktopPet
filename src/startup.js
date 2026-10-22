const LOGIN_NAME = "MilkFrog DesktopPet";

function loginOptions(app) {
  return {
    name: LOGIN_NAME,
    // Portable Electron is extracted to a temporary directory; register the outer EXE.
    path: app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_FILE || process.execPath) : process.execPath,
    args: app.isPackaged ? [] : [`"${app.getAppPath()}"`]
  };
}

function getAutoStart(app) {
  const { path, args } = loginOptions(app);
  const state = app.getLoginItemSettings({ path, args });
  return Boolean(state.openAtLogin && state.executableWillLaunchAtLogin !== false);
}

function setAutoStart(app, enabled) {
  app.setLoginItemSettings({ ...loginOptions(app), openAtLogin: Boolean(enabled) });
  return getAutoStart(app);
}

module.exports = { LOGIN_NAME, loginOptions, getAutoStart, setAutoStart };
