import { MinecraftInstallProgress, JavaPathResult } from "./preload";

const javaStatusElement = document.getElementById('java-status');
const playButton = document.getElementById('play-button') as HTMLButtonElement | null;
const settingsButton = document.getElementById('settings-button') as HTMLButtonElement | null; // Added settings button
const mcProgressMessageElement = document.getElementById('minecraft-progress-message');
const mcProgressBarInnerElement = document.getElementById('minecraft-progress-bar-inner');

let isJavaReady = false;
let isMinecraftInstalled = false;
let isInstalling = false;
let isGameRunning = false;
const TARGET_MINECRAFT_VERSION = "1.18.2";

function updateJavaStatus(message: string, isError: boolean = false) {
    if (javaStatusElement) {
        javaStatusElement.textContent = `Java Status: ${message}`;
        javaStatusElement.style.color = isError ? '#ff8080' : '#aaaaaa';
    }
    isJavaReady = !isError;
    if (isJavaReady) {
        checkIfMinecraftInstalled();
    } else {
        updatePlayButtonState();
    }
}

function updateMinecraftProgress(progress: MinecraftInstallProgress['payload']) {
    if (mcProgressMessageElement) {
        if (progress.message) {
            mcProgressMessageElement.textContent = progress.message;
        }
        mcProgressMessageElement.style.color = progress.isError ? '#ff8080' : '#bbbbbb';
    }
    if (mcProgressBarInnerElement) {
        if (progress.task) {
            const percentage = progress.task.total > 0 ? (progress.task.progress / progress.task.total) * 100 : 0;
            mcProgressBarInnerElement.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
        } else {
            mcProgressBarInnerElement.style.width = progress.isError || progress.message?.toLowerCase().includes("complete") || progress.message?.toLowerCase().includes("success") ? '100%' : '0%';
        }
    }
}

function updatePlayButtonState() {
    if (playButton) {
        if (isGameRunning) {
            playButton.disabled = true;
            playButton.textContent = 'Minecraft is Running...';
        } else if (isInstalling) {
            playButton.disabled = true;
            playButton.textContent = 'Installing...';
        } else if (isJavaReady) {
            playButton.disabled = false;
            playButton.textContent = isMinecraftInstalled ? `Launch Minecraft ${TARGET_MINECRAFT_VERSION}` : `Install Minecraft ${TARGET_MINECRAFT_VERSION}`;
        } else {
            playButton.disabled = true;
            playButton.textContent = 'Java Not Ready';
        }
    }
}

async function checkIfMinecraftInstalled() {
    if (!window.electronAPI || !isJavaReady) return;

    try {
        isMinecraftInstalled = await window.electronAPI.isVersionInstalled(TARGET_MINECRAFT_VERSION);
        if (isMinecraftInstalled) {
            updateMinecraftProgress({ message: `Minecraft ${TARGET_MINECRAFT_VERSION} is installed.` });
        } else {
            updateMinecraftProgress({ message: `Minecraft ${TARGET_MINECRAFT_VERSION} not found. Ready to install.` });
        }
    } catch (error: any) {
        updateMinecraftProgress({ message: `Could not check MC status: ${error.message || error}`, isError: true });
        isMinecraftInstalled = false;
    }
    updatePlayButtonState();
}


async function initializeJavaCheck() {
    if (!window.electronAPI) {
        updateJavaStatus("Error: Preload script not loaded.", true);
        return;
    }
    updateJavaStatus('Checking for Java...');
    
    const removeJavaListener = window.electronAPI.onJavaPathResult((result) => {
        if (result.type === 'success') {
            updateJavaStatus(`Found: ${result.path}`, false);
        } else {
            updateJavaStatus(`${result.message}`, true);
        }
    });

    try {
        const initialResult = await window.electronAPI.getJavaPath();
        if (initialResult.type === 'error' && !javaStatusElement?.textContent?.includes("Found")) {
            updateJavaStatus(initialResult.message, true);
        } else if (initialResult.type === 'success') {
            updateJavaStatus(`Found: ${initialResult.path}`, false);
        }
    } catch (error: any) {
        updateJavaStatus(`Error communicating with main process: ${error.message || error}`, true);
        removeJavaListener(); 
    }
}

function setupMinecraftInstallListener() {
    if (!window.electronAPI) return;
    window.electronAPI.onMinecraftInstallProgress((progress) => {
        updateMinecraftProgress(progress.payload);
        if (progress.type === 'update') {
            if (progress.payload.message?.toLowerCase().includes("success") || progress.payload.message?.toLowerCase().includes("installed successfully")) {
                isInstalling = false;
                isMinecraftInstalled = true; // Mark as installed after successful installation
            } else if (progress.payload.isError) {
                isInstalling = false;
            }
            updatePlayButtonState();
        }
    });
}

function setupGameCloseListener() {
    if (!window.electronAPI) return;
    window.electronAPI.onGameClose((event) => {
        console.log(`Game closed event received: Version ${event.version}, Code: ${event.code}, Error: ${event.error}`);
        isGameRunning = false;
        updateMinecraftProgress({ message: `Minecraft ${event.version} closed.` + (event.error ? ` Error: ${event.error}` : ` Exit code: ${event.code ?? 'N/A'}`), isError: !!event.error});
        updatePlayButtonState();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (settingsButton && window.electronAPI) { // Check if electronAPI is available
        settingsButton.addEventListener('click', () => {
            window.electronAPI.openSettingsWindow();
        });
    } else if (!window.electronAPI) {
        console.error("Settings button: Electron API not available.");
    }


    if (playButton) {
        playButton.addEventListener('click', async () => {
            if (!isJavaReady) {
                alert('Java is not configured correctly. Please check the status.');
                return;
            }
            if (isInstalling || isGameRunning) return;

            if (isMinecraftInstalled) {
                isGameRunning = true;
                updatePlayButtonState();
                updateMinecraftProgress({ message: `Launching Minecraft ${TARGET_MINECRAFT_VERSION}...` });
                try {
                    await window.electronAPI.launchMinecraft(TARGET_MINECRAFT_VERSION, "CRRP_Player", "localhost", 25565);
                } catch (error: any) {
                    updateMinecraftProgress({ message: `Launch IPC Error: ${error.message || error}`, isError: true });
                    isGameRunning = false;
                    updatePlayButtonState();
                }
            } else {
                isInstalling = true;
                updatePlayButtonState();
                updateMinecraftProgress({ message: `Preparing to install Minecraft ${TARGET_MINECRAFT_VERSION}...`});
                try {
                    await window.electronAPI.installMinecraft(TARGET_MINECRAFT_VERSION);
                } catch (error: any) {
                    updateMinecraftProgress({ message: `Install IPC Error: ${error.message || error}`, isError: true });
                    isInstalling = false;
                    updatePlayButtonState();
                }
            }
        });
    }
    initializeJavaCheck();
    setupMinecraftInstallListener();
    setupGameCloseListener();
    updatePlayButtonState(); 
});
