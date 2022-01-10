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


// i18n
/*
//some Pop_OS users started getting _ is not a function error with the line below
const _ = ExtensionUtils.gettext;
//so I had to use the old code instead
*/
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

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
    let settings = ExtensionUtils.getSettings();
    if (set == "enable") {
        displays = [];
        if (settings.get_string('button-location') == "panel") {
            brightnessLog("Adding to panel");
            mainMenuButton = new StatusAreaBrightnessMenu();
            Main.panel.addToStatusArea("DDCUtilBrightnessSlider", mainMenuButton, 0, "right");
        } else {
            brightnessLog("Adding to system menu");
            mainMenuButton = new SystemMenuBrightnessMenu(settings);
            AggregateMenu._indicators.add_child(mainMenuButton);
            AggregateMenu.menu.addMenuItem(mainMenuButton.menu, settings.get_double('position-system-menu'));
        }
        if (mainMenuButton !== null) {
            /* connect all signals */
            connectSettingsSignals(settings);
            connectMonitorChangeSignals();

            addKeyboardShortcuts(settings);

            if (settings.get_string('button-location') == "panel") {
                addTextItemToPanel(_("Initializing"));
                addSettingsItem();
            }

            addAllDisplaysToPanel(settings);
        }

    } else if (set == "disable") {
        /* disconnect all signals */
        disconnectSettingsSignals(settings);
        disconnectMonitorSignals();

        /* remove shortcuts */
        removeKeyboardShortcuts();

        /* clear timeouts */
        if (_reloadMenuWidgetsTimer) {
            Convenience.clearTimeout(_reloadMenuWidgetsTimer);
        }
        displays.forEach(display=>{
            if('slider' in display){
                display.slider.destory();
            }
        })

        /* clear variables */
        mainMenuButton.destroy();
        mainMenuButton = null;
        displays = null;
        settings = null;
    }
}

function setBrightness(settings, display, newValue) {
    let newBrightness = parseInt((newValue / 100) * display.max);
    if (newBrightness <= minBrightnessThreshold) {
        if (settings.get_boolean('allow-zero-brightness')) {
            newBrightness = 0;
        } else {
            newBrightness = minBrightness;
        }
    }
    //brightnessLog(`${ddcutil_path} setvcp 10 ${newBrightness} --bus ${display.bus}`)
    GLib.spawn_command_line_async(`${ddcutil_path} setvcp 10 ${newBrightness} --bus ${display.bus}`)
}

function setAllBrightness(settings, newValue) {
    displays.forEach(display => {
        display.slider.changeValue(newValue);
        setBrightness(settings, display, newValue);
    });
}

function addSettingsItem() {
    let settingsItem = new PopupMenu.PopupMenuItem(_("Settings"));
    settingsItem.connect('activate', ()=>{
        ExtensionUtils.openPrefs();
    });
    mainMenuButton.addMenuItem(settingsItem, 1);

    let reloadItem = new PopupMenu.PopupMenuItem(_("Reload"));
    reloadItem.connect('activate', event => {
        reloadExtension();
    });
    mainMenuButton.addMenuItem(reloadItem, 2);
}

function addAllSlider(settings) {
    let onAllSliderChange = function (newValue) {
        setAllBrightness(settings, newValue);
    }
    let allslider = new SingleMonitorSliderAndValue(settings, _("All"), displays[0].current, onAllSliderChange);
    mainMenuButton.addMenuItem(allslider)

    /* save slider in main menu, so that it can be accessed easily for different events */
    mainMenuButton.storeValueSliderForEvents(allslider.getValueSlider())
}

function addDisplayToPanel(settings, display) {
    let onSliderChange = function (newValue) {
        setBrightness(settings, display, newValue)
    }
    let displaySlider = new SingleMonitorSliderAndValue(settings, display.name, display.current, onSliderChange);
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
function reloadMenuWidgets(settings) {
    if (_reloadMenuWidgetsTimer) {
        Convenience.clearTimeout(_reloadMenuWidgetsTimer);
    }
    _reloadMenuWidgetsTimer = Convenience.setTimeout(() => {
        _reloadMenuWidgetsTimer = null;
        _reloadMenuWidgets(settings);
    }, 1000)
}

function _reloadMenuWidgets(settings) {
    if (mainMenuButton === null) {
        return;
    }

    brightnessLog("Reloading widgets");

    mainMenuButton.removeAllMenu();
    mainMenuButton.clearStoredValueSliders();

    if (settings.get_boolean('show-all-slider')) {
        addAllSlider(settings);
    }
    displays.forEach(display => {
        addDisplayToPanel(settings, display);
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

function parseDisplaysInfoAndAddToPanel(settings, ddcutil_brief_info) {
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
                        if (!settings.get_boolean('disable-display-state-check')) {
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
                                reloadMenuWidgets(settings);
                            });
                        }
                    }
                });

            }
            if (ddc_line.indexOf("Monitor:") !== -1) {
                /* Monitor name comes second in the output,
                 so when that is detected fill the object and push it to list */
                display_names[diplay_loop_id] = ddc_line.split("Monitor:")[1].trim().split(":")[1].trim()
                diplay_loop_id++;
            }
        });
    } catch (err) {
        brightnessLog(err);
    }
}

function getDisplaysInfoAsync(settings) {
    Convenience.spawnWithCallback([ddcutil_path, "detect", "--brief"], function (stdout) {
        parseDisplaysInfoAndAddToPanel(settings, stdout);
    });
}

function getCachedDisplayInfoAsync(settings) {
    let file = Gio.File.new_for_path(ddcutil_detect_cache_file)
    let cancellable = new Gio.Cancellable();
    file.load_contents_async(cancellable, (source, result) => {
        try {
            let [ok, contents, etag_out] = source.load_contents_finish(result);
            parseDisplaysInfoAndAddToPanel(settings, ByteArray.toString(contents));
        } catch (e) {
            brightnessLog(`${ddcutil_detect_cache_file} cache file reading error`)
        }
    });
    Convenience.spawnWithCallback(["cat", ddcutil_detect_cache_file], function (stdout) { });
}

function onSettingsChange(settings) {
    brightnessLog("Settings change detected, reloading widgets")
    removeKeyboardShortcuts()
    addKeyboardShortcuts(settings)
    reloadMenuWidgets(settings)
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
        reloadExtension();
    }, 5000);

}

let settingsSignals = {};

function connectSettingsSignals(settings) {
    settingsSignals = {
        change: settings.connect('changed', ()=>{
            onSettingsChange(settings)
        }),
        reload: settings.connect('changed::reload', reloadExtension),
        indicator: settings.connect('changed::button-location', reloadExtension),
        hide_system_indicator: settings.connect('changed::hide-system-indicator', reloadExtension),
        position_system_menu: settings.connect('changed::position-system-menu', reloadExtension)
    }
}

let monitorSignals = {}

function connectMonitorChangeSignals() {
    monitorSignals = {
        change: Main.layoutManager.connect('monitors-changed', onMonitorChange),
    }
}

function disconnectSettingsSignals(settings) {
    settings.disconnect(settingsSignals.change);
}

function disconnectMonitorSignals() {
    Main.layoutManager.disconnect(monitorSignals.change);
}

function addAllDisplaysToPanel(settings) {
    try {
        if (GLib.file_test(ddcutil_detect_cache_file, (GLib.FileTest.IS_REGULAR))) {
            getCachedDisplayInfoAsync(settings);
        } else {
            getDisplaysInfoAsync(settings);
        }
    } catch (err) {
        brightnessLog(err);
    }
}

function increase() {
    brightnessLog("Increase brightness");
    mainMenuButton.emit('value-up')
}

function decrease() {
    brightnessLog("Decrease brightness");
    mainMenuButton.emit('value-down');
}

function addKeyboardShortcuts(settings) {
    brightnessLog("Add keyboard shortcuts");
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
    brightnessLog("Remove keyboard shortcuts");
    Main.wm.removeKeybinding('increase-brightness-shortcut');
    Main.wm.removeKeybinding('decrease-brightness-shortcut');
}
