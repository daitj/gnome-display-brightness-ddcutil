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
const {GLib, Gio, St} = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Gettext = imports.gettext;

const Convenience = Me.imports.convenience;

const Domain = Gettext.domain(Me.metadata['gettext-domain']);
const _ = Domain.gettext;

//for ui stuff of this extension
const { 
    StatusAreaBrightnessMenu, 
    SingleMonitorMenuItem, 
    SingleMonitorSliderAndValue } = Me.imports.ui;

const PopupMenu = imports.ui.popupMenu;

const {SHOW_ALL_SLIDER, SHOW_VALUE_LABEL} = Me.imports.convenience;

/* lowest possible value for brightness */
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
    ExtensionUtils.initTranslations(Me.metadata['gettext-domain']);

    return new DDCUtilBrightnessControlExtension();
}

function brightnessLog(str){
    log("display-brightness-ddcutil extension:\n"+str);
}
function BrightnessControl(set) {
    if (set == "enable") {
        mainMenuButton = new StatusAreaBrightnessMenu();
        Main.panel.addToStatusArea("DDCUtilBrightnessSlider", mainMenuButton, 0, "right");
        if (mainMenuButton !== null) {
            /* connect all signals */
            connectSettingsSignals();
            connectMonitorChangeSignals();

            addTextItemToPanel(_("Initializing"));
            addSettingsItem();

            addAllDisplaysToPanel();
        }
        

    } else if (set == "disable") {
        /* disconnect all signals */
        disconnectSettingsSignals();
        disconnectMonitorSignals();

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
        newBrightness = minBrightness;
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
    mainMenuButton.addMenuItem(settingsItem,1);

    let reloadItem = new PopupMenu.PopupMenuItem(_("Reload"));
    reloadItem.connect('activate', event => {
        BrightnessControl("disable");
        BrightnessControl("enable");
    });
    mainMenuButton.addMenuItem(reloadItem,2);
}

function addAllSlider() {
    let onAllSliderChange = function (newValue) {
        setAllBrightness(newValue);
    }
    let allslider = new SingleMonitorSliderAndValue(_("All"), displays[0].current, onAllSliderChange);
    mainMenuButton.addMenuItem(allslider)
}

function addDisplayToPanel(display) {
    let onSliderChange = function (newValue) {
        setBrightness(display, newValue)
    }
    let displaySlider = new SingleMonitorSliderAndValue(display.name, display.current, onSliderChange);
    display.slider = displaySlider;
    mainMenuButton.addMenuItem(displaySlider);
}

function reloadMenuWidgets() {
    if(mainMenuButton === null){
        return;
    }
    mainMenuButton.removeAllMenu();

    if (settings.get_boolean(SHOW_ALL_SLIDER)) {
        addAllSlider();
    }
    displays.forEach(display => {
        addDisplayToPanel(display);
    });
    addSettingsItem();
}

function addTextItemToPanel(text) {
    if(mainMenuButton === null) return;
    let menuItem = new PopupMenu.PopupMenuItem(text, {
        reactive: false
    });
    mainMenuButton.addMenuItem(menuItem);
}

function parseDisplaysInfoAndAddToPanel(ddcutil_brief_info, panel) {
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
                brightnessLog("ddcutil brief info found bus line:\n" +  " "+ ddc_line)
                /* I2C bus comes first, so when that is detect start a new display object */
                let display_bus = ddc_line.split("/dev/i2c-")[1].trim();
                /* save diplay_loop_id as a const for rest of the async calls below here*/
                const display_id = diplay_loop_id;
                /* check if display is on or not */
                brightnessLog("ddcutil reading display state for bus: " +display_bus)
                Convenience.spawnWithCallback([ddcutil_path, "getvcp", "--brief", "D6", "--bus", display_bus], function (vcpPowerInfos) {
                    brightnessLog("ddcutil reading display status for bus: " + display_bus +" is: " + vcpPowerInfos)
                    /* only add display to list if ddc communication is supported with the bus*/
                    if (vcpPowerInfos.indexOf("DDC communication failed") === -1) {
                        let vcpPowerInfosArray = vcpPowerInfos.trim().split(" ");
                        /* 
                         D6 = Power mode
                         x01 = DPM: On,  DPMS: Off
                        */
                        if (vcpPowerInfosArray.length >= 4  && vcpPowerInfosArray[3] == "x01"){
                            /* read the current and max brightness using getvcp 10 */
                            Convenience.spawnWithCallback([ddcutil_path, "getvcp", "--brief", "10", "--bus", display_bus], function (vcpInfos) {
                                let display = {};

                                let vcpInfosArray = vcpInfos.trim().split(" ");
                                let maxBrightness = vcpInfosArray[4];
                                /* we need current brightness in the scale of 0 to 1 for slider*/
                                let currentBrightness = vcpInfosArray[3] / vcpInfosArray[4];

                                /* make display object */
                                display = { "bus": display_bus, "max": maxBrightness, "current": currentBrightness, "name": display_names[display_id]};
                                displays.push(display);

                                /* cheap way of making reloading all display slider in the panel */
                                reloadMenuWidgets(panel);
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
        parseDisplaysInfoAndAddToPanel(stdout, panel);
    });
}

function getCachedDisplayInfoAsync(panel) {
    let file = Gio.File.new_for_path(ddcutil_detect_cache_file)
    let cancellable = new Gio.Cancellable();
    file.load_contents_async(cancellable, (source, result) => {
        try {
            let [ok, contents, etag_out] = source.load_contents_finish(result);
            parseDisplaysInfoAndAddToPanel(ByteArray.toString(contents), panel);
        } catch (e) {
            brightnessLog(`${ddcutil_detect_cache_file} cache file reading error`)
        }
    });
    Convenience.spawnWithCallback(["cat", ddcutil_detect_cache_file], function (stdout) { });
}



function onSettingsChange(){
    brightnessLog("Settings change detected, reloading widgets")
    reloadMenuWidgets()
}

let monitorChangeTimeout = null;

function onMonitorChange(){
    /* 
    when monitor change happens, 
    sometimes the turned off monitor is still accepting DDC connection
    this is not a great fix, because some monitor 
    will still take longer than 5 seconds to be off
    */
   brightnessLog("Monitor change detected, reloading extension in 5 seconds.")
    if(monitorChangeTimeout !== null){
        Convenience.clearTimeout(monitorChangeTimeout)
    }
    monitorChangeTimeout = Convenience.setTimeout(function(){
        monitorChangeTimeout = null;
        BrightnessControl("disable");
        BrightnessControl("enable");
    }, 5000);

}

let settingsSignals = {};

function connectSettingsSignals() {
    settingsSignals = {
        change: settings.connect('changed', onSettingsChange)
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

function addAllDisplaysToPanel(){
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
