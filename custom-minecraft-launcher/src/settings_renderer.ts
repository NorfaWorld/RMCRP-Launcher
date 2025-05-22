import { LauncherSettings } from "./preload"; // Assuming LauncherSettings is defined in preload.ts

const minecraftPathInput = document.getElementById('minecraft-path') as HTMLInputElement | null;
const maxMemoryInput = document.getElementById('max-memory') as HTMLInputElement | null;
const browsePathButton = document.getElementById('browse-path-button') as HTMLButtonElement | null;
const saveButton = document.getElementById('save-settings-button') as HTMLButtonElement | null;
const cancelButton = document.getElementById('cancel-settings-button') as HTMLButtonElement | null;

async function loadSettings() {
    if (!window.electronAPI) {
        console.error("Electron API not available in settings window.");
        alert("Error: Cannot load settings. Preload script might have failed.");
        return;
    }
    try {
        const settings = await window.electronAPI.getSettings();
        if (minecraftPathInput && settings.minecraftPath) {
            minecraftPathInput.value = settings.minecraftPath;
        }
        if (maxMemoryInput && settings.maxMemoryMB) {
            maxMemoryInput.value = settings.maxMemoryMB.toString();
        }
    } catch (error) {
        console.error("Failed to load settings:", error);
        alert(`Error loading settings: ${error}`);
    }
}

async function saveSettings() {
    if (!window.electronAPI) {
        alert("Error: Cannot save settings. Preload script might have failed.");
        return;
    }
    const newSettings: LauncherSettings = {};
    if (minecraftPathInput) {
        newSettings.minecraftPath = minecraftPathInput.value;
    }
    if (maxMemoryInput) {
        const mem = parseInt(maxMemoryInput.value, 10);
        if (!isNaN(mem) && mem >= 512) {
            newSettings.maxMemoryMB = mem;
        } else {
            alert("Invalid RAM value. Please enter a number greater than or equal to 512.");
            return; // Don't save if RAM is invalid
        }
    }

    try {
        await window.electronAPI.saveSettings(newSettings);
        window.electronAPI.closeSettingsWindow(); // Close window after saving
    } catch (error) {
        console.error("Failed to save settings:", error);
        alert(`Error saving settings: ${error}`);
    }
}

function cancelSettings() {
    if (!window.electronAPI) {
        alert("Error: Cannot close settings window. Preload script might have failed.");
        return;
    }
    window.electronAPI.closeSettingsWindow();
}

async function browseForMinecraftPath() {
    if (!window.electronAPI) {
        alert("Error: File dialog cannot be shown. Preload script might have failed.");
        return;
    }
    try {
        const result = await window.electronAPI.showOpenDialog({
            title: 'Select Minecraft Data Directory',
            properties: ['openDirectory', 'createDirectory']
        });
        if (!result.canceled && result.filePaths.length > 0 && minecraftPathInput) {
            minecraftPathInput.value = result.filePaths[0];
        }
    } catch (error) {
        console.error("Error opening directory dialog:", error);
        alert(`Error selecting directory: ${error}`);
    }
}


document.addEventListener('DOMContentLoaded', () => {
    loadSettings();

    if (saveButton) {
        saveButton.addEventListener('click', saveSettings);
    }
    if (cancelButton) {
        cancelButton.addEventListener('click', cancelSettings);
    }
    if (browsePathButton) {
        browsePathButton.addEventListener('click', browseForMinecraftPath);
    }
});
