# Yellow Jelly desktop pet 奶蛙桌宠

这是一个Windows奶蛙桌宠，灵感来自 BongoCat。桌宠会根据键盘输入和鼠标点击播放对应动作，也支持眼珠跟随鼠标、音效、装扮菜单和大小调整。

<img width="280" height="186" alt="54a380af2e46fb9b83350c5d2ab7490f" src="https://github.com/user-attachments/assets/15f12d3e-b3b3-4f8c-beca-3e6012aec3cf" />
运行具有反作弊的网游时，桌宠可能无法正常使用
[点击下载 o(*￣▽￣*)ブ 最新版本](../../releases/latest)

普通用户只需要下载 Release 里的 Windows exe 文件即可使用

## 功能

- 透明背景、无边框、置顶桌宠窗口
- 全局鼠标位置检测，让眼珠轻微追随鼠标
- 全局键盘按键检测，打字时播放敲键盘动画
- 鼠标点击动画
- 右键菜单切换装扮
- 右键菜单调整桌宠大小
- 静音开关
- 离线运行

## 隐私说明

程序只检测输入状态：

- 键盘：检测“有按键被按下”
- 鼠标：检测鼠标位置和鼠标按键状态

程序不会读取、保存或上传你输入的文字内容，也不会记录键盘日志，不会截图，不会发送网络请求。

更详细说明见 [PRIVACY.md](./PRIVACY.md)。

## 开发运行

```bash
npm install
npm start
```

## 打包

```bash
npm run build
```

打包结果会输出到：

```text
dist/
```

## 技术说明

本项目使用 Electron 开发。Windows 全局输入检测通过运行时生成的小型 PowerShell 辅助脚本完成，该脚本只调用 Windows `user32.dll` 读取按键、鼠标按钮和鼠标位置状态。

## License

MIT

