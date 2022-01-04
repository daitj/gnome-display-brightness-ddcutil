/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const Main = imports.ui.main;
const ByteArray = imports.byteArray;
const { GLib, Gio, Meta, Shell, St } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const _ = ExtensionUtils.gettext;

const Convenience = Me.imports.convenience;

//for ui stuff of this extension
const {
    StatusAreaBrightnessMenu,
    SystemMenuBrightnessMenu,
    SingleMonitorSliderAndValue
} = Me.imports.indicator;

const PopupMenu = imports.ui.popupMenu;
const AggregateMenu = Main.panel.statusArea.aggregateMenu;

const {
    brightnessLog
} = Me.imports.convenience;

/* lowest possible value for brightness
    this is skipped if allow-zero-brightness is set
*/
const minBrightness = 1;

/* when should min brightness value should be used */
const minBrightnessThreshold = 5;

let displays = [];

let mainMenuButton = null;

let timeoutId = null;

/*
    instead of reading i2c bus everytime during startup,
    as it is unlikely that bus number changes, we can read
    cache file instead.
    one can make this file by running following shell command:
    ddcutil --brief detect > $XDG_CACHE_HOME/ddcutil_detect
*/
const cache_dir = GLib.get_user_cache_dir()
const ddcutil_detect_cache_file = `${cache_dir}/ddcutil_detect`;

const ddcutil_path = "/usr/bin/ddcutil";

class DDCUtilBrightnessControlExtension {
    constructor() { }
    enable() {
        BrightnessControl("enable")
    }
    disable() {
        BrightnessControl("disable")
    }
}

function init() {
    ExtensionUtils.initTranslations();

    return new DDCUtilBrightnessControlExtension();
}


function BrightnessControl(set) {
    if (set == "enable") {
        if (settings.get_string('button-location') == "panel") {
            brightnessLog("Adding to panel");
            mainMenuButton = new StatusAreaBrightnessMenu();
            Main.panel.addToStatusArea("DDCUtilBrightnessSlider", mainMenuButton, 0, "right");
        } else {
            brightnessLog("Adding to system menu");
            mainMenuButton = new SystemMenuBrightnessMenu();
            AggregateMenu._indicators.add_child(mainMenuButton);
            AggregateMenu.menu.addMenuItem(mainMenuButton.menu, 3);
        }
        if (mainMenuButton !== null) {
            /* connect all signals */
            connectSettingsSignals();
            connectMonitorChangeSignals();

            addKeyboardShortcuts();

            if (settings.get_string('button-location') == "panel") {
                addTextItemToPanel(_("Initializing"));
                addSettingsItem();
            }

            addAllDisplaysToPanel();
        }

    } else if (set == "disable") {
        /* disconnect all signals */
        disconnectSettingsSignals();
        disconnectMonitorSignals();

        removeKeyboardShortcuts();

        mainMenuButton.destroy();
        mainMenuButton = null;
        displays = [];
        if (timeoutId) {
            Convenience.clearTimeout(timeoutId)
        }
    }
}

function setBrightness(display, newValue) {
    let newBrightness = parseInt((newValue / 100) * display.max);
    if (newBrightness <= minBrightnessThreshold) {
        if (settings.get_boolean('allow-zero-brightness')) {
            newBrightness = 0;
        } else {
            newBrightness = minBrightness;
        }
    }
    GLib.spawn_command_line_async(`${ddcutil_path} setvcp 10 ${newBrightness} --bus ${display.bus}`)
}

function setAllBrightness(newValue) {
    displays.forEach(element => {
        element.slider.changeValue(newValue);
        setBrightness(element, newValue);
    });
}

function addSettingsItem() {
    let settingsItem = new PopupMenu.PopupMenuItem(_("Settings"));
    settingsItem.connect('activate', openPrefs);
    mainMenuButton.addMenuItem(settingsItem, 1);

    let reloadItem = new PopupMenu.PopupMenuItem(_("Reload"));
    reloadItem.connect('activate', event => {
        reloadExtension();
    });
    mainMenuButton.addMenuItem(reloadItem, 2);
}

function addAllSlider() {
    let onAllSliderChange = function (newValue) {
        setAllBrightness(newValue);
    }
    let allslider = new SingleMonitorSliderAndValue(_("All"), displays[0].current, onAllSliderChange);
    mainMenuButton.addMenuItem(allslider)

    /* save slider in main menu, so that it can be accessed easily for different events */
    mainMenuButton.storeValueSliderForEvents(allslider.getValueSlider())
}

function addDisplayToPanel(display) {
    let onSliderChange = function (newValue) {
        setBrightness(display, newValue)
    }
    let displaySlider = new SingleMonitorSliderAndValue(display.name, display.current, onSliderChange);
    display.slider = displaySlider;
    mainMenuButton.addMenuItem(displaySlider);

    /* when "All" slider is shown we do not need to store each display's value slider */
    /* save slider in main menu, so that it can be accessed easily for different events */
    if (!settings.get_boolean('show-all-slider')) {
        mainMenuButton.storeValueSliderForEvents(displaySlider.getValueSlider())
    }

}

let _reloadMenuWidgetsTimer = null;
/* 
   reload menu widgets being called many time caused some lag
   after every display info was parsed, add this should run reloadMenuWidgets only once
 */
function reloadMenuWidgets() {
    if (_reloadMenuWidgetsTimer) {
        Convenience.clearTimeout(_reloadMenuWidgetsTimer);
    }
    _reloadMenuWidgetsTimer = Convenience.setTimeout(() => {
        _reloadMenuWidgetsTimer = null;
        _reloadMenuWidgets();
    }, 1000)
}

function _reloadMenuWidgets() {
    if (mainMenuButton === null) {
        return;
    }
    console.debug("Reloading widgets");

    mainMenuButton.removeAllMenu();
    mainMenuButton.clearStoredValueSliders();

    if (settings.get_boolean('show-all-slider')) {
        addAllSlider();
    }
    displays.forEach(display => {
        addDisplayToPanel(display);
    });

    if (settings.get_string('button-location') == "panel") {
        addSettingsItem();
    }
}

function reloadExtension() {
    brightnessLog("Reload extension");
    BrightnessControl("disable");
    BrightnessControl("enable");
}

function addTextItemToPanel(text) {
    if (mainMenuButton === null) return;
    let menuItem = new PopupMenu.PopupMenuItem(text, {
        reactive: false
    });
    mainMenuButton.addMenuItem(menuItem);
}

function parseDisplaysInfoAndAddToPanel(ddcutil_brief_info) {
    try {
        let display_names = [];
        /*
        due to spawnWithCallback fetching faster information for second display in list before first one
        there is a situation where name is displayed for first device but controls second device.

        To fix that, we define our own id inside the loop, which is used to detect right device.
        */
        let diplay_loop_id = 0;
        brightnessLog("ddcutil brief info:\n" + ddcutil_brief_info);
        ddcutil_brief_info.split('\n').map(ddc_line => {
            if (ddc_line.indexOf("/dev/i2c-") !== -1) {
                brightnessLog("ddcutil brief info found bus line:\n" + " " + ddc_line)
                /* I2C bus comes first, so when that is detect start a new display object */
                let display_bus = ddc_line.split("/dev/i2c-")[1].trim();
                /* save diplay_loop_id as a const for rest of the async calls below here*/
                const display_id = diplay_loop_id;
                /* check if display is on or not */
                brightnessLog("ddcutil reading display state for bus: " + display_bus)
                Convenience.spawnWithCallback([ddcutil_path, "getvcp", "--brief", "D6", "--bus", display_bus], function (vcpPowerInfos) {
                    brightnessLog("ddcutil reading display status for bus: " + display_bus + " is: " + vcpPowerInfos)
                    /* only add display to list if ddc communication is supported with the bus*/
                    if (vcpPowerInfos.indexOf("DDC communication failed") === -1) {
                        let vcpPowerInfosArray = vcpPowerInfos.trim().split(" ");

                        let stateCheck = (vcpPowerInfosArray.length >= 4);
                        if (!settings.get_string('disable-display-state-check')) {
                            /*
                             D6 = Power mode
                             x01 = DPM: On,  DPMS: Off
                            */
                            stateCheck = (stateCheck && vcpPowerInfosArray[3] == "x01")
                        }
                        if (stateCheck) {
                            /* read the current and max brightness using getvcp 10 */
                            Convenience.spawnWithCallback([ddcutil_path, "getvcp", "--brief", "10", "--bus", display_bus], function (vcpInfos) {
                                let display = {};

                                let vcpInfosArray = vcpInfos.trim().split(" ");
                                let maxBrightness = vcpInfosArray[4];
                                /* we need current brightness in the scale of 0 to 1 for slider*/
                                let currentBrightness = vcpInfosArray[3] / vcpInfosArray[4];

                                /* make display object */
                                display = { "bus": display_bus, "max": maxBrightness, "current": currentBrightness, "name": display_names[display_id] };
                                displays.push(display);

                                /* cheap way of making reloading all display slider in the panel */
                                reloadMenuWidgets();
                            });
                        }
                    }
                });

            }
            if (ddc_line.indexOf("Monitor:") !== -1) {
                /* Monitor name comes second in the output,
                 so when that is detected fill the object and push it to list */
                display_names[diplay_loop_id] = ddc_line.split(_("Monitor:"))[1].trim().split(":")[1].trim()
                diplay_loop_id++;
            }
        });
    } catch (err) {
        brightnessLog(err);
    }
}

function getDisplaysInfoAsync(panel) {
    Convenience.spawnWithCallback([ddcutil_path, "detect", "--brief"], function (stdout) {
        parseDisplaysInfoAndAddToPanel(stdout);
    });
}

function getCachedDisplayInfoAsync(panel) {
    let file = Gio.File.new_for_path(ddcutil_detect_cache_file)
    let cancellable = new Gio.Cancellable();
    file.load_contents_async(cancellable, (source, result) => {
        try {
            let [ok, contents, etag_out] = source.load_contents_finish(result);
            parseDisplaysInfoAndAddToPanel(ByteArray.toString(contents));
        } catch (e) {
            brightnessLog(`${ddcutil_detect_cache_file} cache file reading error`)
        }
    });
    Convenience.spawnWithCallback(["cat", ddcutil_detect_cache_file], function (stdout) { });
}

function onSettingsChange() {
    brightnessLog("Settings change detected, reloading widgets")
    removeKeyboardShortcuts()
    addKeyboardShortcuts()
    reloadMenuWidgets()
}

let monitorChangeTimeout = null;

function onMonitorChange() {
    /* 
    when monitor change happens,
    sometimes the turned off monitor is still accepting DDC connection
    this is not a great fix, because some monitor
    will still take longer than 5 seconds to be off
    */
    brightnessLog("Monitor change detected, reloading extension in 5 seconds.")
    if (monitorChangeTimeout !== null) {
        Convenience.clearTimeout(monitorChangeTimeout)
    }
    monitorChangeTimeout = Convenience.setTimeout(function () {
        monitorChangeTimeout = null;
        BrightnessControl("disable");
        BrightnessControl("enable");
    }, 5000);

}

let settingsSignals = {};

function connectSettingsSignals() {
    settingsSignals = {
        change: settings.connect('changed', onSettingsChange),
        reload: settings.connect('changed::reload', reloadExtension),
        indicator: settings.connect('changed::button-location', reloadExtension)
    }
}

let monitorSignals = {}

function connectMonitorChangeSignals() {
    monitorSignals = {
        change: Main.layoutManager.connect('monitors-changed', onMonitorChange),
    }
}

function disconnectSettingsSignals() {
    settings.disconnect(settingsSignals.change);
}

function disconnectMonitorSignals() {
    Main.layoutManager.disconnect(monitorSignals.change);
}

function addAllDisplaysToPanel() {
    try {
        if (GLib.file_test(ddcutil_detect_cache_file, (GLib.FileTest.IS_REGULAR))) {
            getCachedDisplayInfoAsync(mainMenuButton);
        } else {
            getDisplaysInfoAsync(mainMenuButton);
        }
    } catch (err) {
        brightnessLog(err);
    }
}

function openPrefs() {
    if (typeof ExtensionUtils.openPrefs === 'function') {
        ExtensionUtils.openPrefs();
    } else {
        Util.spawn(['sh', '-c',
            'command -v gnome-extensions 2>&1 && gnome-extensions prefs ' +
            Me.uuid +
            ' || gnome-shell-extension-prefs ' +
            Me.uuid
        ]);
    }
}

function increase() {
    console.debug("Increase brightness");
    mainMenuButton.emit('value-up')
}

function decrease() {
    console.debug("Decrease brightness");
    mainMenuButton.emit('value-down');
}

function addKeyboardShortcuts() {
    console.debug("Add keyboard shortcuts");
    Main.wm.addKeybinding(
        'increase-brightness-shortcut',
        settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.ALL,
        this.increase.bind(this)
    );
    Main.wm.addKeybinding(
        'decrease-brightness-shortcut',
        settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.ALL,
        this.decrease.bind(this)
    );
}

function removeKeyboardShortcuts() {
    console.debug("Remove keyboard shortcuts");
    Main.wm.removeKeybinding('increase-brightness-shortcut');
    Main.wm.removeKeybinding('decrease-brightness-shortcut');
}
