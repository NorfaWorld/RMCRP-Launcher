import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Define a type for the Java path result
export type JavaPathResult = 
  | { type: 'success'; path: string } 
  | { type: 'error'; message: string };

// Define a type for Minecraft installation progress
export interface MinecraftInstallProgress {
  type: 'progress' | 'update';
  payload: {
    task?: {
        path: string;
        progress: number;
        total: number;
        threads?: number;
    };
    message?: string;
    isError?: boolean;
  };
}

// Define a type for Launcher Settings
export interface LauncherSettings {
    minecraftPath?: string;
    maxMemoryMB?: number;
}

// Define the API exposed to the renderer process
export interface ElectronAPI {
  // Java Path
  getJavaPath: () => Promise<JavaPathResult>;
  onJavaPathResult: (callback: (result: JavaPathResult) => void) => () => void;
  
  // Minecraft Installation
  installMinecraft: (version: string) => Promise<void>;
  onMinecraftInstallProgress: (callback: (progress: MinecraftInstallProgress) => void) => () => void;

  // Minecraft Launching
  launchMinecraft: (version: string, username: string, serverIp?: string, serverPort?: number) => Promise<void>;
  onGameClose: (callback: (event: { version: string, code?: number, error?: string }) => void) => () => void;
  isVersionInstalled: (version: string) => Promise<boolean>;

  // Settings Window
  openSettingsWindow: () => void;
  closeSettingsWindow: () => void; // For settings window to close itself
  getSettings: () => Promise<LauncherSettings>;
  saveSettings: (settings: LauncherSettings) => Promise<void>;
  showOpenDialog: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>;
}

const exposedAPI: ElectronAPI = {
  // Java Path
  getJavaPath: () => ipcRenderer.invoke('get-java-path'),
  onJavaPathResult: (callback) => {
    const listener = (_event: IpcRendererEvent, result: JavaPathResult) => callback(result);
    ipcRenderer.on('java-path-result', listener);
    return () => ipcRenderer.removeListener('java-path-result', listener);
  },

  // Minecraft Installation
  installMinecraft: (version) => ipcRenderer.invoke('install-minecraft', version),
  onMinecraftInstallProgress: (callback) => {
    const listener = (_event: IpcRendererEvent, progress: MinecraftInstallProgress) => callback(progress);
    ipcRenderer.on('minecraft-install-progress', listener);
    return () => ipcRenderer.removeListener('minecraft-install-progress', listener);
  },

  // Minecraft Launching
  launchMinecraft: (version, username, serverIp, serverPort) => ipcRenderer.invoke('launch-minecraft', version, username, serverIp, serverPort),
  onGameClose: (callback) => {
    const listener = (_event: IpcRendererEvent, event: { version: string, code?: number, error?: string }) => callback(event);
    ipcRenderer.on('game-close-event', listener);
    return () => ipcRenderer.removeListener('game-close-event', listener);
  },
  isVersionInstalled: (version: string) => ipcRenderer.invoke('is-version-installed', version),

  // Settings Window
  openSettingsWindow: () => ipcRenderer.send('open-settings-window'),
  closeSettingsWindow: () => ipcRenderer.send('close-settings-window'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
};

contextBridge.exposeInMainWorld('electronAPI', exposedAPI);

// Augment the Window interface for TypeScript
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
