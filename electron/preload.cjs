/**
 * 预加载脚本：把目录选择 / 配置读取以受控方式暴露给渲染层。
 * 当前 UI 不依赖这些 API（配置在启动时消费），预留给后续"设置"界面。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pixelmusic", {
  getConfig: () => ipcRenderer.invoke("pixelmusic:config:get"),
  chooseMusicDir: () => ipcRenderer.invoke("pixelmusic:dir:choose"),
  setFullScreen: (flag) => ipcRenderer.invoke("pixelmusic:fullscreen:set", flag),
});
