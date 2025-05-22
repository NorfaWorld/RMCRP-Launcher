import { app, BrowserWindow, ipcMain, dialog } from 'electron'; // Added dialog
import path from 'path';
import fs from 'fs';
import findJavaHome from 'find-java-home';
import Store from 'electron-store';
import { JavaPathResult, MinecraftInstallProgress, LauncherSettings } from './preload'; // Added LauncherSettings

import { Launcher, Version, Installer, LaunchOption } from '@xmcl/minecraft-launcher-core';
import { ResolvedVersion } from '@xmcl/core';
import { Task } from '@xmcl/task';
import { ChildProcess } from 'child_process';


// Define the structure of our store
interface AppStore {
  javaPath?: string;
  lastJavaCheckDate?: string;
  minecraftPath: string; // Made non-optional due to default
  selectedUser: { username: string }; // Made non-optional
  launcherSettings: { minMemoryMB: number, maxMemoryMB: number}; // Made non-optional
}

const store = new Store<AppStore>({
  defaults: {
    javaPath: undefined,
    lastJavaCheckDate: undefined,
    minecraftPath: path.join(app.getPath('userData'), 'minecraft-data'),
    selectedUser: { username: 'CRRP_Player' },
    // Ensure minMemoryMB is also part of the store if you want to configure it.
    // For this task, only maxMemoryMB is explicitly mentioned for settings UI.
    launcherSettings: { minMemoryMB: 1024, maxMemoryMB: 2048 } 
  }
});

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let gameProcess: ChildProcess | null = null;


function sendInstallProgress(progress: MinecraftInstallProgress['payload']) {
  if (mainWindow) {
    mainWindow.webContents.send('minecraft-install-progress', { type: 'progress', payload: progress });
  }
}

function sendInstallUpdate(message: string, isError: boolean = false) {
    if (mainWindow) {
      mainWindow.webContents.send('minecraft-install-progress', { type: 'update', payload: { message, isError } });
    }
  }

function sendGameCloseEvent(version: string, code?: number, error?: string) {
    if (mainWindow) {
        mainWindow.webContents.send('game-close-event', { version, code, error });
    }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 850,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const indexPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'dist', 'index.html')
    : path.join(__dirname, '../src/index.html');

  mainWindow.loadFile(indexPath)
    .catch(err => console.error('Failed to load index.html:', err, 'Attempted path:', indexPath));

  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 550,
        height: 450, // Adjusted height
        title: 'Launcher Settings',
        parent: mainWindow!, // Make it a child of the main window
        modal: true, // Make it modal
        resizable: false,
        minimizable: false,
        maximizable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // Re-use preload for IPC
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !app.isPackaged // Enable DevTools only in development
        },
    });

    const settingsHtmlPath = path.join(__dirname, '../src/settings.html');
    settingsWindow.loadFile(settingsHtmlPath)
        .catch(err => console.error('Failed to load settings.html:', err, 'Attempted path:', settingsHtmlPath));
    
    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}


async function detectAndStoreJava(): Promise<JavaPathResult> {
  const storedJavaPath = store.get('javaPath');
  if (storedJavaPath) {
    return { type: 'success', path: storedJavaPath };
  }
  return new Promise((resolve) => {
    findJavaHome({ allowJre: true }, (err, home) => {
      if (err || !home) {
        const errorMessage = `Java not found. Error: ${err || 'find-java-home returned empty.'} Please install Java (JDK or JRE 8+) or set JAVA_HOME.`;
        resolve({ type: 'error', message: errorMessage });
        return;
      }
      let executablePath = process.platform === 'win32' ? path.join(home, 'bin', 'java.exe') : path.join(home, 'bin', 'java');
      store.set('javaPath', executablePath);
      store.set('lastJavaCheckDate', new Date().toISOString());
      resolve({ type: 'success', path: executablePath });
    });
  });
}

async function prepareMinecraftClient(versionString: string): Promise<void> {
  const minecraftPath = store.get('minecraftPath'); // Uses new setting
  const javaPath = store.get('javaPath');

  if (!javaPath) {
    sendInstallUpdate('Java path not configured. Please ensure Java is detected.', true);
    return;
  }
  sendInstallUpdate(`Starting download for Minecraft ${versionString} to ${minecraftPath}...`);
  try {
    const resolvedVersion: ResolvedVersion = await Version.parse(minecraftPath, versionString);
    sendInstallUpdate(`Version manifest for ${resolvedVersion.id} fetched.`);
    const installTask: Task<void> = Installer.installVersionTask(resolvedVersion, minecraftPath, { java: javaPath });
    
    await Task.dispatch(installTask, { /* ... progress handlers ... */ }); // Assume progress handlers are unchanged
    sendInstallUpdate(`Minecraft ${versionString} installed successfully to ${minecraftPath}.`);
  } catch (error: any) {
    sendInstallUpdate(`Error preparing Minecraft client ${versionString}: ${error.message || error}`, true);
  }
}

async function launchMinecraftGame(versionString: string, username: string, serverIp?: string, serverPort?: number): Promise<void> {
    if (gameProcess) {
        sendGameCloseEvent(versionString, undefined, 'Game is already running.');
        return;
    }

    const minecraftPath = store.get('minecraftPath'); // Uses new setting
    const javaPath = store.get('javaPath');
    const currentLauncherSettings = store.get('launcherSettings'); // Uses new setting
    const user = store.get('selectedUser');

    if (!javaPath || !minecraftPath) {
        const message = !javaPath ? 'Java path not configured.' : 'Minecraft path not configured.';
        sendGameCloseEvent(versionString, undefined, message);
        console.error(message);
        return;
    }

    const options: LaunchOption = {
        version: versionString,
        gamePath: minecraftPath,
        javaPath: javaPath,
        user: { 
            name: username || user.username,
            type: 'offline',
            accessToken: '0',
            uuid: Launcher.Utils.getOfflineUUID(username || user.username)
        },
        minMemory: currentLauncherSettings.minMemoryMB,
        maxMemory: currentLauncherSettings.maxMemoryMB, // Uses new setting
        server: serverIp && serverPort ? { ip: serverIp, port: serverPort } : undefined,
        extraExecOption: {detached: true}
    };

    sendInstallUpdate(`Launching Minecraft ${versionString}...`);
    try {
        gameProcess = await Launcher.launch(options);
        if (!gameProcess) throw new Error("Launcher.launch did not return a process.");
        sendInstallUpdate(`Minecraft ${versionString} is running (PID: ${gameProcess.pid}).`);
        gameProcess.stdout?.on('data', (data) => console.log(`[MC STDOUT - ${versionString}]: ${data.toString().trim()}`));
        gameProcess.stderr?.on('data', (data) => console.error(`[MC STDERR - ${versionString}]: ${data.toString().trim()}`));
        gameProcess.on('close', (code) => {
            sendGameCloseEvent(versionString, code ?? undefined);
            gameProcess = null;
        });
        gameProcess.on('error', (err) => {
            sendGameCloseEvent(versionString, undefined, err.message);
            gameProcess = null;
        });
    } catch (error: any) {
        sendGameCloseEvent(versionString, undefined, error.message || 'Unknown launch error.');
        sendInstallUpdate(`Error launching Minecraft: ${error.message || error}`, true);
        gameProcess = null;
    }
}

function isVersionInstalled(versionString: string): boolean {
    const minecraftPath = store.get('minecraftPath');
    const versionJsonPath = path.join(minecraftPath, 'versions', versionString, `${versionString}.json`);
    return fs.existsSync(versionJsonPath);
}


app.on('ready', async () => {
  createWindow();

  ipcMain.on('open-settings-window', createSettingsWindow);
  ipcMain.on('close-settings-window', () => {
    if (settingsWindow) {
        settingsWindow.close();
        settingsWindow = null;
    }
  });

  ipcMain.handle('get-settings', async (): Promise<LauncherSettings> => {
    return {
        minecraftPath: store.get('minecraftPath'),
        maxMemoryMB: store.get('launcherSettings').maxMemoryMB
    };
  });

  ipcMain.handle('save-settings', async (_event, settings: LauncherSettings) => {
    if (settings.minecraftPath) {
        store.set('minecraftPath', settings.minecraftPath);
    }
    if (settings.maxMemoryMB) {
        const currentSettings = store.get('launcherSettings');
        store.set('launcherSettings', { ...currentSettings, maxMemoryMB: settings.maxMemoryMB });
    }
    console.log('Settings saved:', store.store); // Log all stored settings
  });

  ipcMain.handle('show-open-dialog', async (_event, options: Electron.OpenDialogOptions) => {
    if (settingsWindow) { // Ensure dialog is modal to settings window if it's open
        return dialog.showOpenDialog(settingsWindow, options);
    } else if (mainWindow) { // Fallback to main window
        return dialog.showOpenDialog(mainWindow, options);
    }
    return dialog.showOpenDialog(options); // Fallback if no window is available (should not happen)
  });


  ipcMain.handle('get-java-path', async () => { /* ... */ }); // Unchanged
  ipcMain.handle('install-minecraft', async (_event, version: string) => { /* ... */ }); // Unchanged
  ipcMain.handle('launch-minecraft', async (_event, version: string, username: string, serverIp?: string, serverPort?: number) => { /* ... */ }); // Unchanged
  ipcMain.handle('is-version-installed', (_event, version: string) => { /* ... */ }); // Unchanged


  const mcPath = store.get('minecraftPath')!;
  if (!fs.existsSync(mcPath)) {
    try {
      fs.mkdirSync(mcPath, { recursive: true });
    } catch (e) { console.error(`Failed to create Minecraft data directory ${mcPath}:`, e); }
  }
});

app.on('window-all-closed', () => { /* ... */ }); // Unchanged
app.on('activate', () => { /* ... */ }); // Unchanged
app.on('will-quit', () => { /* ... */ }); // Unchanged

// Ensure unchanged handlers are not truncated
ipcMain.handle('get-java-path', async () => {
    const result = await detectAndStoreJava();
    if (mainWindow) {
      mainWindow.webContents.send('java-path-result', result);
    }
    return result;
});
ipcMain.handle('install-minecraft', async (_event, version: string) => {
    console.log(`Received install-minecraft event for version: ${version}`);
    await prepareMinecraftClient(version);
});
ipcMain.handle('launch-minecraft', async (_event, version: string, username: string, serverIp?: string, serverPort?: number) => {
    console.log(`Received launch-minecraft event for version: ${version}, user: ${username}, server: ${serverIp}:${serverPort}`);
    await launchMinecraftGame(version, username, serverIp, serverPort);
});
ipcMain.handle('is-version-installed', (_event, version: string) => {
    return isVersionInstalled(version);
});
Task.dispatch = Task.dispatch.bind(Task); // Re-bind if necessary, or ensure context is correct if it was an issue.
Installer.installVersionTask = Installer.installVersionTask.bind(Installer);
Version.parse = Version.parse.bind(Version);
Launcher.launch = Launcher.launch.bind(Launcher);
