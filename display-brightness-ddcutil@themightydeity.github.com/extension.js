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
const _ = ExtensionUtils.gettext;

const Convenience = Me.imports.convenience;

//for ui stuff of this extension
const {
    StatusAreaBrightnessMenu,
    SystemMenuBrightnessMenu,
    SingleMonitorSliderAndValueForStatusAreaMenu,
    SingleMonitorSliderAndValueForQuickSettings
} = Me.imports.indicator;

const PopupMenu = imports.ui.popupMenu;
const QuickSettings = imports.ui.quickSettings;
const QuickSettingsPanelMenuButton = Main.panel.statusArea.quickSettings

const {
    brightnessLog
} = Me.imports.convenience;

/* 
    lowest possible value for brightness
    this is skipped if allow-zero-brightness is set
*/
const minBrightness = 1;

let displays = null;

let mainMenuButton = null;

let writeCollection = null;



/*
    instead of reading i2c bus everytime during startup,
    as it is unlikely that bus number changes, we can read
    cache file instead.
    one can make this file by running following shell command:
    ddcutil --brief detect > $XDG_CACHE_HOME/ddcutil_detect
*/
const cache_dir = GLib.get_user_cache_dir()
const ddcutil_detect_cache_file = `${cache_dir}/ddcutil_detect`;


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
        writeCollection = {};
        if (settings.get_int('button-location') === 0) {
            brightnessLog("Adding to panel");
            mainMenuButton = new StatusAreaBrightnessMenu(settings);
            Main.panel.addToStatusArea("DDCUtilBrightnessSlider", mainMenuButton, 0, "right");
        } else {
            brightnessLog("Adding to system menu");
            mainMenuButton = new SystemMenuBrightnessMenu(settings);
            QuickSettingsPanelMenuButton._indicators.insert_child_at_index(mainMenuButton, settings.get_double('position-system-indicator'));
        }
        if (mainMenuButton !== null) {
            /* connect all signals */
            connectSettingsSignals(settings);
            connectMonitorChangeSignals();

            addKeyboardShortcuts(settings);

            if (settings.get_int('button-location') === 0) {
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
        if (_reloadExtensionTimer) {
            Convenience.clearTimeout(_reloadExtensionTimer);
        }
        Object.keys(writeCollection).forEach((bus)=>{
            if(writeCollection[bus].interval !== null){
                Convenience.clearInterval(writeCollection[bus].interval);
            }
        });

        displays.forEach(display => {
            if ('slider' in display) {
                display.slider.destory();
            }
        })

        /* clear variables */
        mainMenuButton.destroy();
        mainMenuButton = null;
        displays = null;
        settings = null;
        writeCollection = null;

    }
}

function ddcWriteInQueue(settings, display_bus){
    if(writeCollection[display_bus].interval == null){
        writeCollection[display_bus].interval = Convenience.setInterval(()=>{
            if(writeCollection[display_bus].countdown == 0){
                brightnessLog(`Write in queue countdown over for ${display_bus}`);
                writeCollection[display_bus].writer();
                Convenience.clearInterval(writeCollection[display_bus].interval);
                writeCollection[display_bus].interval = null;
                const writeCollectorWaitMs = parseInt(settings.get_double('ddcutil-queue-ms'))
                writeCollection[display_bus].countdown = writeCollectorWaitMs;

            }else{
                writeCollection[display_bus].countdown = writeCollection[display_bus].countdown - 1;
            }
        }, 1);
    }
}
function ddcWriteCollector(settings, display_bus, writer){
    if(display_bus in writeCollection){
        /* by setting writer to latest one, 
        when waiting is over latest writer will run */
        writeCollection[display_bus].writer = writer;
        brightnessLog(`Write collector update, current countdown is ${writeCollection[display_bus].countdown} for ${display_bus}`);
        /* countdown is over, meaning update process for this display can be added to the queue */
        const writeCollectorWaitMs = parseInt(settings.get_double('ddcutil-queue-ms'))
        if(writeCollection[display_bus].countdown == writeCollectorWaitMs){
            brightnessLog(`Write collector update, trigger queue again`);
            ddcWriteInQueue(settings, display_bus);
        }
    }else{
        brightnessLog(`Write collector defining new display ${display_bus} and adding it to queue`);
        /* display query is not defined yet */
        writeCollection[display_bus] = {
            countdown: 0,
            interval: null,
            writer: writer
        }
        ddcWriteInQueue(settings, display_bus);
    }
    
}
function setBrightness(settings, display, newValue) {
    let newBrightness = parseInt((newValue / 100) * display.max);
    if (newBrightness == 0) {
        if (!settings.get_boolean('allow-zero-brightness')) {
            newBrightness = minBrightness;
        }
    }
    const ddcutilPath = settings.get_string('ddcutil-binary-path');
    const ddcutilAdditionalArgs = settings.get_string('ddcutil-additional-args');
    const sleepMultiplier = (settings.get_double('ddcutil-sleep-multiplier'))/40;
    const writer = ()=>{
        brightnessLog(`async ${ddcutilPath} setvcp 10 ${newBrightness} --bus ${display.bus} --sleep-multiplier ${sleepMultiplier} ${ddcutilAdditionalArgs}`);
        GLib.spawn_command_line_async(`${ddcutilPath} setvcp 10 ${newBrightness} --bus ${display.bus} --sleep-multiplier ${sleepMultiplier} ${ddcutilAdditionalArgs}`)
    }
    brightnessLog(`display ${display.name}, current: ${display.current} => ${newValue/100}, new brightness: ${newBrightness}, new value: ${newValue}`);
    display.current = newValue/100

/* 
    Lowest value for writeCollectorWaitMs is 130ms
    45 ms ddcutil delay,
    85 ms waiting after write to i2c controller, 
    check #74 for details
*/

    ddcWriteCollector(settings, display.bus, writer);
}

function setAllBrightness(settings, newValue) {
    displays.forEach(display => {
        display.slider.setHideOSD()
        display.slider.changeValue(newValue);
        display.slider.resetOSD()
    });
}

function addSettingsItem() {
    let settingsItem = new PopupMenu.PopupMenuItem(_("Settings"));
    settingsItem.connect('activate', () => {
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
    let onAllSliderChange = function (quickSettingsSlider, newValue) {
        setAllBrightness(settings, newValue);
    }
    let allslider = null;
    if (settings.get_int('button-location') === 0) {
        allslider = new SingleMonitorSliderAndValueForStatusAreaMenu(settings, _("All"), displays[0].current, onAllSliderChange);
    }else{
        allslider = new SingleMonitorSliderAndValueForQuickSettings({
            settings: settings,
            'display-name': _("All"),
            'current-value': displays[0].current
        });
        allslider.connect('slider-change', onAllSliderChange);
    }
    mainMenuButton.addMenuItem(allslider)

    /* save slider in main menu, so that it can be accessed easily for different events */
    mainMenuButton.storeSliderForEvents(allslider)
}

function addDisplayToPanel(settings, display) {
    let onSliderChange = function (quickSettingsSlider, newValue) {
        setBrightness(settings, display, newValue);
    }
    let displaySlider = null;
    if (settings.get_int('button-location') === 0) {
        displaySlider = new SingleMonitorSliderAndValueForStatusAreaMenu(settings, display.name, display.current, onSliderChange);
    }else{
        displaySlider = new SingleMonitorSliderAndValueForQuickSettings({
            settings: settings,
            'display-name': display.name,
            'current-value': display.current
        });
        displaySlider.connect('slider-change', onSliderChange);
    }
    
    display.slider = displaySlider;
    if (!(settings.get_boolean('show-all-slider') && settings.get_boolean('only-all-slider'))) {
        mainMenuButton.addMenuItem(displaySlider);
    }

    /* when "All" slider is shown we do not need to store each display's value slider */
    /* save slider in main menu, so that it can be accessed easily for different events */
    if (!settings.get_boolean('show-all-slider')) {
        mainMenuButton.storeSliderForEvents(displaySlider)
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
    if (reloadingExtension) {
        /* do nothing if extension is being reloaded */
        brightnessLog("Skipping reloadMenuWidgets because extensions is reloading, timer ref: " + _reloadExtensionTimer);
        return;
    }

    if (mainMenuButton === null) {
        return;
    }

    brightnessLog("Reloading widgets");

    mainMenuButton.removeAllMenu();
    mainMenuButton.clearStoredSliders();

    if(displays.length == 0){
        mainMenuButton.indicatorVisibility(false);
    }else{
        mainMenuButton.indicatorVisibility(true);
        if (settings.get_boolean('show-all-slider')) {
            addAllSlider(settings);
        }
        displays.forEach(display => {
            addDisplayToPanel(settings, display);
        });
        
        if (settings.get_int('button-location') === 0) {
            addSettingsItem();
        }else{
            /* in case of quick settings we need to add items after all the sliders were created */

            /*  easiest way to add sliders to panel area is :
                QuickSettingsPanelMenuButton._addItems(mainMenuButton.quickSettingsItems, 2);
                we need something more though.
            */
            const _grid = QuickSettingsPanelMenuButton.menu._grid;
            /*
                but we want custom positioning, this is bit of a hack to access 
                _grid (St.Widget) directly and add items there, 
            */
            mainMenuButton.quickSettingsItems.forEach((item)=>{
                /*
                also for Label and Name we are accessing slider's parent's parent
                Slider->Parent(St.Bin)->Parent(St.BoxLayout)
                */
                const _box = item.slider.get_parent().get_parent();
                if(settings.get_boolean('show-display-name')){
                    _box.insert_child_at_index(item.NameContainer, 1);
                }
                _grid.insert_child_at_index(item, settings.get_double('position-system-menu'));
                _grid.layout_manager.child_set_property(_grid, item, 'column-span', 2)
                if(settings.get_boolean('show-value-label')){
                    _box.insert_child_at_index(item.ValueLabel, 3);
                }
            })
        }
    }
}

let _reloadExtensionTimer = null;
let reloadingExtension = false;

/* 
   reloading extension being called many times caused some lag
   and also reloading menu widgets when reload extension was already called
   caused unecessary extra ddcutil calls.
 */
function reloadExtension() {
    reloadingExtension = true;
    if (_reloadExtensionTimer) {
        Convenience.clearTimeout(_reloadExtensionTimer);
    }
    _reloadExtensionTimer = Convenience.setTimeout(() => {
        _reloadExtensionTimer = null;
        _reloadExtension();
    }, 1000)
}

function _reloadExtension() {
    brightnessLog("Reload extension");
    BrightnessControl("disable");
    BrightnessControl("enable");
    reloadingExtension = false;
}

function moveIndicator(settings){
    brightnessLog("System indicator moved");
    if (mainMenuButton === null) return;
    QuickSettingsPanelMenuButton._indicators.set_child_at_index(mainMenuButton, settings.get_double('position-system-indicator'));
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
        const ddcutil_path = settings.get_string('ddcutil-binary-path')
        let display_names = [];
        /*
        due to spawnWithCallback fetching faster information for second display in list before first one
        there is a situation where name is displayed for first device but controls second device.

        To fix that, we define our own id inside the loop, which is used to detect right device.
        */
        let diplay_loop_id = 0;
        brightnessLog("ddcutil brief info:\n" + ddcutil_brief_info);
        const sleepMultiplier = (settings.get_double('ddcutil-sleep-multiplier'))/40;
        ddcutil_brief_info.split('\n').map(ddc_line => {
            if (ddc_line.indexOf("/dev/i2c-") !== -1) {
                brightnessLog("ddcutil brief info found bus line:\n" + " " + ddc_line)
                /* I2C bus comes first, so when that is detect start a new display object */
                let display_bus = ddc_line.split("/dev/i2c-")[1].trim();
                /* save diplay_loop_id as a const for rest of the async calls below here*/
                const display_id = diplay_loop_id;
                /* check if display is on or not */
                brightnessLog("ddcutil reading display state for bus: " + display_bus)
                Convenience.spawnWithCallback([ddcutil_path, "getvcp", "--brief", "D6", "--bus", display_bus, "--sleep-multiplier", sleepMultiplier.toString()], function (vcpPowerInfos) {
                    brightnessLog("ddcutil reading display status for bus: " + display_bus + " is: " + vcpPowerInfos)
                    /* only add display to list if ddc communication is supported with the bus*/
                    if (vcpPowerInfos.indexOf("DDC communication failed") === -1 && vcpPowerInfos.indexOf("No monitor detected") === -1) {
                        let vcpPowerInfosArray = vcpPowerInfos.trim().split(" ");

                        let displayInGoodState = true;
                        if (!settings.get_boolean('disable-display-state-check')) {
                            /*
                             D6 = Power mode
                             x01 = DPM: On,  DPMS: Off
                            */
                             displayInGoodState = (vcpPowerInfosArray.length >= 4 && vcpPowerInfosArray[3] == "x01")
                        }
                        if (displayInGoodState) {
                            /* read the current and max brightness using getvcp 10 */
                            Convenience.spawnWithCallback([ddcutil_path, "getvcp", "--brief", "10", "--bus", display_bus, "--sleep-multiplier", sleepMultiplier.toString()], function (vcpInfos) {
                                if (vcpInfos.indexOf("DDC communication failed") === -1 && vcpInfos.indexOf("No monitor detected") === -1) {
                                    let vcpInfosArray = vcpInfos.trim().split(" ");
                                    if (vcpInfosArray[2] != "ERR" && vcpInfosArray.length >= 5) {
                                        let display = {};

                                        let maxBrightness = vcpInfosArray[4];
                                        /* we need current brightness in the scale of 0 to 1 for slider*/
                                        let currentBrightness = vcpInfosArray[3] / vcpInfosArray[4];

                                        /* make display object */
                                        display = { "bus": display_bus, "max": maxBrightness, "current": currentBrightness, "name": display_names[display_id] };
                                        displays.push(display);

                                        /* cheap way of making reloading all display slider in the panel */
                                        reloadMenuWidgets(settings);
                                    }
                                }
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
    const ddcutil_path = settings.get_string('ddcutil-binary-path')
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
function settingsToJSObject(settings){
    const out = {
        "allow-zero-brightness":settings.get_boolean('allow-zero-brightness'),
        "disable-display-state-check":settings.get_boolean('disable-display-state-check'),
        "hide-system-indicator":settings.get_boolean('hide-system-indicator'),
        "only-all-slider":settings.get_boolean('only-all-slider'),
        "show-all-slider":settings.get_boolean('show-all-slider'),
        "show-display-name":settings.get_boolean('show-display-name'),
        "show-value-label":settings.get_boolean('show-value-label'),
        "verbose-debugging":settings.get_boolean('verbose-debugging'),
        "ddcutil-queue-ms":settings.get_double('ddcutil-queue-ms'),
        "ddcutil-sleep-multiplier":settings.get_double('ddcutil-sleep-multiplier'),
        "position-system-indicator":settings.get_double('position-system-indicator'),
        "position-system-menu":settings.get_double('position-system-menu'),
        "step-change-keyboard":settings.get_double('step-change-keyboard'),
        "button-location":settings.get_int('button-location'),
        "ddcutil-additional-args":settings.get_string('ddcutil-additional-args'),
        "ddcutil-binary-path":settings.get_string('ddcutil-binary-path'),
        "decrease-brightness-shortcut":settings.get_strv('decrease-brightness-shortcut'),
        "increase-brightness-shortcut":settings.get_strv('increase-brightness-shortcut')
    }
    return out
}
function onSettingsChange(settings) {
    brightnessLog("Settings change detected, reloading widgets")
    removeKeyboardShortcuts()
    addKeyboardShortcuts(settings)
    reloadMenuWidgets(settings)
    if(settings.get_boolean('verbose-debugging')){
        brightnessLog(JSON.stringify(settingsToJSObject(settings)))
    }
    const writeCollectorWaitMs = parseInt(settings.get_double('ddcutil-queue-ms'))
    Object.keys(writeCollection).forEach((display_bus)=>{
        writeCollection[display_bus].countdown = writeCollectorWaitMs;
        if(writeCollection[display_bus].interval !== null){
            Convenience.clearInterval(writeCollection[display_bus].interval)
        }
        writeCollection[display_bus].interval = null
    })
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
let oldSettings = null;

function connectSettingsSignals(settings) {
    oldSettings = settings;
    settingsSignals = {
        change: settings.connect('changed', () => {
            onSettingsChange(settings)
        }),
        reload: settings.connect('changed::reload', reloadExtension),
        indicator: settings.connect('changed::button-location', reloadExtension),
        hide_system_indicator: settings.connect('changed::hide-system-indicator', reloadExtension),
        position_system_indicator: settings.connect('changed::position-system-indicator', function(settings){
            moveIndicator(settings);
        }),
        position_system_menu: settings.connect('changed::position-system-menu', reloadExtension),
        disable_display_state_check: settings.connect('changed::disable-display-state-check', reloadExtension),
        verbose_debugging: settings.connect('changed::verbose-debugging', reloadExtension)
    }
}

let monitorSignals = {}

function connectMonitorChangeSignals() {
    monitorSignals = {
        change: Main.layoutManager.connect('monitors-changed', onMonitorChange),
    }
}

function disconnectSettingsSignals() {
    Object.values(settingsSignals).forEach(signal => {
        oldSettings.disconnect(signal);
    });
    settingsSignals = {};
    oldSettings = null;
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
