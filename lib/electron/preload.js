import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('deskpet', {
    onEvent: (callback) => ipcRenderer.on('pet:event', (_event, value) => callback(value)),
    send: (message) => ipcRenderer.send('pet:command', message),
    // The resize grip needs the window to follow the pointer frame by frame; routing that
    // through the host WebSocket would round-trip every intermediate size.
    resize: (width, height) => ipcRenderer.send('pet:resize', width, height),
    // Click-through is decided per cursor position in the renderer (it alone knows
    // where the model's pixels are), so it reports the verdict rather than a toggle.
    setPointerInteractive: (interactive) => ipcRenderer.send('pet:pointer-interactive', interactive),
});
