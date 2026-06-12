const { ipcRenderer } = require('electron');

// Expose APIs directly on window (works with contextIsolation: false)
window.ipc = {
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, fn) => ipcRenderer.on(channel, (e, ...args) => fn(...args)),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  sendSync: (channel, ...args) => ipcRenderer.sendSync(channel, ...args),
};

// Expose hotkey control API
window.electronAPI = {
  disableHotkeys: () => ipcRenderer.send('disable-hotkeys'),
  enableHotkeys: () => ipcRenderer.send('enable-hotkeys'),
};
