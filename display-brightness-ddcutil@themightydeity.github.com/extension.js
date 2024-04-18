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
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

// menu items
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension,  gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Convenience from './convenienceExt.js';
import * as Indicator from './indicator.js';

// for ui stuff of this extension
const QuickSettingsPanelMenuButton = Main.panel.statusArea.quickSettings;

const {
    StatusAreaBrightnessMenu,
    SystemMenuBrightnessMenu,
    SingleMonitorSliderAndValueForStatusAreaMenu,
    SingleMonitorSliderAndValueForQuickSettings,
} = Indicator;

const {
    brightnessLog,
    spawnWithCallback,
    filterVCPInfoSpecification
} = Convenience;

/*
    lowest possible value for brightness
    this is skipped if allow-zero-brightness is set
*/
const minBrightness = 1;
let displays = null;
let mainMenuButton = null;
let writeCollection = null;
let _reloadMenuWidgetsTimer = null;
let _reloadExtensionTimer = null;
let reloadingExtension = false;
let monitorChangeTimeout = null;
let settingsSignals = {};
let oldSettings = null;
let monitorSignals = {};

/*
    instead of reading i2c bus everytime during startup,
    as it is unlikely that bus number changes, we can read
    cache file instead.
    one can make this file by running following shell command:
    ddcutil --brief detect > $XDG_CACHE_HOME/ddcutil_detect
*/
const cacheDir = GLib.get_user_cache_dir();
const ddcutilDetectCacheFile = `${cacheDir}/ddcutil_detect`;

export default class DDCUtilBrightnessControlExtension extends Extension {
    enable() {
        this.settings = this.getSettings();
        this.brightnessControl('enable', this.settings);
    }

    disable() {
        this.brightnessControl('disable', this.settings);
        this.settings = null;
    }

    brightnessControl(set) {
        if (set === 'enable') {
            displays = [];
            writeCollection = {};
            if (this.settings.get_int('button-location') === 0) {
                brightnessLog(this.settings, 'Adding to panel');
                mainMenuButton = new StatusAreaBrightnessMenu(this.settings);
                Main.panel.addToStatusArea('DDCUtilBrightnessSlider', mainMenuButton, 0, 'right');
            } else {
                brightnessLog(this.settings, 'Adding to system menu');
                mainMenuButton = new SystemMenuBrightnessMenu(this.settings);
                QuickSettingsPanelMenuButton._indicators.insert_child_at_index(mainMenuButton, this.settings.get_double('position-system-indicator'));
            }
            if (mainMenuButton !== null) {
                /* connect all signals */
                this.connectSettingsSignals();
                this.connectMonitorChangeSignals();

                this.addKeyboardShortcuts();

                if (this.settings.get_int('button-location') === 0) {
                    this.addTextItemToPanel(_('Initializing'));
                    this.addSettingsItem();
                }

                this.addAllDisplaysToPanel();
            }
        } else if (set === 'disable') {
            /* disconnect all signals */
            this.disconnectSettingsSignals();
            this.disconnectMonitorSignals();

            /* remove shortcuts */
            this.removeKeyboardShortcuts();

            /* clear timeouts */
            if (_reloadMenuWidgetsTimer)
                clearTimeout(_reloadMenuWidgetsTimer);

            if (_reloadExtensionTimer)
                clearTimeout(_reloadExtensionTimer);

            Object.keys(writeCollection).forEach(bus => {
                if (writeCollection[bus].interval !== null){
                    clearInterval(writeCollection[bus].interval);
                }
            });
            if(monitorChangeTimeout !== null){
                clearTimeout(monitorChangeTimeout)
                monitorChangeTimeout = null;
            }

            /* clear variables */
            mainMenuButton.destroy();
            mainMenuButton = null;
            displays = null;
            writeCollection = null;
        }
    }

    ddcWriteInQueue(displayBus) {
        if (writeCollection[displayBus].interval == null) {
            writeCollection[displayBus].interval = setInterval(() => {
                if (writeCollection[displayBus].countdown === 0) {
                    brightnessLog(this.settings, `Write in queue countdown over for ${displayBus}`);
                    writeCollection[displayBus].writer();
                    clearInterval(writeCollection[displayBus].interval);
                    writeCollection[displayBus].interval = null;
                    const writeCollectorWaitMs = parseInt(this.settings.get_double('ddcutil-queue-ms'));
                    writeCollection[displayBus].countdown = writeCollectorWaitMs;
                } else {
                    writeCollection[displayBus].countdown = writeCollection[displayBus].countdown - 1;
                }
            }, 1);
        }
    }

    ddcWriteCollector(displayBus, writer) {
        if (displayBus in writeCollection) {
            /* by setting writer to latest one,
            when waiting is over latest writer will run */
            writeCollection[displayBus].writer = writer;
            brightnessLog(this.settings, `Write collector update, current countdown is ${writeCollection[displayBus].countdown} for ${displayBus}`);
            /* countdown is over, meaning update process for this display can be added to the queue */
            const writeCollectorWaitMs = parseInt(this.settings.get_double('ddcutil-queue-ms'));
            if (writeCollection[displayBus].countdown === writeCollectorWaitMs) {
                brightnessLog(this.settings, 'Write collector update, trigger queue again');
                this.ddcWriteInQueue(displayBus);
            }
        } else {
            brightnessLog(this.settings, `Write collector defining new display ${displayBus} and adding it to queue`);
            /* display query is not defined yet */
            writeCollection[displayBus] = {
                countdown: 0,
                interval: null,
                writer,
            };
            this.ddcWriteInQueue(displayBus);
        }
    }

    setBrightness(display, newValue) {
        let newBrightness = parseInt((newValue / 100) * display.max);
        if (newBrightness === 0) {
            if (!this.settings.get_boolean('allow-zero-brightness'))
                newBrightness = minBrightness;
        }
        const ddcutilPath = this.settings.get_string('ddcutil-binary-path');
        const ddcutilAdditionalArgs = this.settings.get_string('ddcutil-additional-args');
        const sleepMultiplier = this.settings.get_double('ddcutil-sleep-multiplier') / 40;
        const writer = () => {
            brightnessLog(this.settings, `async ${ddcutilPath} setvcp 10 ${newBrightness} --bus ${display.bus} --sleep-multiplier ${sleepMultiplier} ${ddcutilAdditionalArgs}`);
            GLib.spawn_command_line_async(`${ddcutilPath} setvcp 10 ${newBrightness} --bus ${display.bus} --sleep-multiplier ${sleepMultiplier} ${ddcutilAdditionalArgs}`);
        };
        brightnessLog(this.settings, `display ${display.name}, current: ${display.current} => ${newValue / 100}, new brightness: ${newBrightness}, new value: ${newValue}`);
        display.current = newValue / 100;

        /*
            Lowest value for writeCollectorWaitMs is 130ms
            45 ms ddcutil delay,
            85 ms waiting after write to i2c controller,
            check #74 for details
        */

        this.ddcWriteCollector(display.bus, writer);
    }

    setAllBrightness(newValue) {
        displays.forEach(display => {
            display.slider.setHideOSD();
            display.slider.changeValue(newValue);
            display.slider.resetOSD();
        });
    }

    addSettingsItem() {
        const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
        settingsItem.connect('activate', () => {
            this.openPreferences();
        });
        mainMenuButton.addMenuItem(settingsItem, 1);

        const reloadItem = new PopupMenu.PopupMenuItem(_('Reload'));
        reloadItem.connect('activate', event => {
            this.reloadExtension();
        });
        mainMenuButton.addMenuItem(reloadItem, 2);
    }

    addAllSlider() {
        const onAllSliderChange = (quickSettingsSlider, newValue) => {
            this.setAllBrightness(newValue);
        };
        let allslider = null;
        if (this.settings.get_int('button-location') === 0) {
            allslider = new SingleMonitorSliderAndValueForStatusAreaMenu(this.settings, _('All'), displays[0].current, onAllSliderChange);
        } else {
            allslider = new SingleMonitorSliderAndValueForQuickSettings({
                settings: this.settings,
                'display-name': _('All'),
                'current-value': displays[0].current,
            });
            allslider.connect('slider-change', onAllSliderChange);
        }
        mainMenuButton.addMenuItem(allslider);

        /* save slider in main menu, so that it can be accessed easily for different events */
        mainMenuButton.storeSliderForEvents(allslider);
    }

    addDisplayToPanel(display) {
        const onSliderChange = (quickSettingsSlider, newValue) => {
            this.setBrightness(display, newValue);
        };
        let displaySlider = null;
        if (this.settings.get_int('button-location') === 0) {
            displaySlider = new SingleMonitorSliderAndValueForStatusAreaMenu(this.settings, display.name, display.current, onSliderChange);
        } else {
            displaySlider = new SingleMonitorSliderAndValueForQuickSettings({
                settings: this.settings,
                'display-name': display.name,
                'current-value': display.current,
            });
            displaySlider.connect('slider-change', onSliderChange);
        }

        display.slider = displaySlider;
        if (!(this.settings.get_boolean('show-all-slider') && this.settings.get_boolean('only-all-slider')))
            mainMenuButton.addMenuItem(displaySlider);


        /* when "All" slider is shown we do not need to store each display's value slider */
        /* save slider in main menu, so that it can be accessed easily for different events */
        if (!this.settings.get_boolean('show-all-slider'))
            mainMenuButton.storeSliderForEvents(displaySlider);
    }

    /*
       reload menu widgets being called many time caused some lag
       after every display info was parsed, add this should run reloadMenuWidgets only once
     */
    reloadMenuWidgets() {
        if (_reloadMenuWidgetsTimer)
            clearTimeout(_reloadMenuWidgetsTimer);

        _reloadMenuWidgetsTimer = setTimeout(() => {
            _reloadMenuWidgetsTimer = null;
            this._reloadMenuWidgets();
        }, 1000);
    }

    _reloadMenuWidgets() {
        if (reloadingExtension) {
            /* do nothing if extension is being reloaded */
            brightnessLog(this.settings, `Skipping reloadMenuWidgets because extensions is reloading, timer ref: ${_reloadExtensionTimer}`);
            return;
        }

        if (mainMenuButton === null)
            return;


        brightnessLog(this.settings, 'Reloading widgets');

        mainMenuButton.removeAllMenu();
        mainMenuButton.clearStoredSliders();

        if (displays.length === 0) {
            mainMenuButton.indicatorVisibility(false);
        } else {
            mainMenuButton.indicatorVisibility(true);
            if (this.settings.get_boolean('show-all-slider'))
                this.addAllSlider();

            displays.forEach(display => {
                this.addDisplayToPanel(display);
            });

            if (this.settings.get_int('button-location') === 0) {
                this.addSettingsItem();
            } else {
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
                mainMenuButton.quickSettingsItems.forEach(item => {
                    /*
                        also for Label and Name we are accessing slider's parent's parent
                        Slider->Parent(St.Bin)->Parent(St.BoxLayout)
                    */
                    const _box = item.slider.get_parent().get_parent();
                    if (this.settings.get_boolean('show-display-name'))
                        _box.insert_child_at_index(item.NameContainer, 1);

                    _grid.insert_child_at_index(item, this.settings.get_double('position-system-menu'));
                    _grid.layout_manager.child_set_property(_grid, item, 'column-span', 2);
                    if (this.settings.get_boolean('show-value-label'))
                        _box.insert_child_at_index(item.ValueLabel, 3);
                });
            }
        }
    }

    /*
       reloading extension being called many times caused some lag
       and also reloading menu widgets when reload extension was already called
       caused unecessary extra ddcutil calls.
     */
    reloadExtension() {
        reloadingExtension = true;
        if (_reloadExtensionTimer)
            clearTimeout(_reloadExtensionTimer);

        _reloadExtensionTimer = setTimeout(() => {
            _reloadExtensionTimer = null;
            this._reloadExtension();
        }, 1000);
    }

    _reloadExtension() {
        brightnessLog(this.settings, 'Reload extension');
        this.brightnessControl('disable');
        this.brightnessControl('enable');
        reloadingExtension = false;
    }

    moveIndicator() {
        brightnessLog(this.settings, 'System indicator moved');
        if (mainMenuButton === null)
            return;
        QuickSettingsPanelMenuButton._indicators.set_child_at_index(mainMenuButton, this.settings.get_double('position-system-indicator'));
    }


    addTextItemToPanel(text) {
        if (mainMenuButton === null)
            return;
        const menuItem = new PopupMenu.PopupMenuItem(text, {
            reactive: false,
        });
        mainMenuButton.addMenuItem(menuItem);
    }

    parseDisplaysInfoAndAddToPanel(ddcutilBriefInfo) {
        try {
            const ddcutilPath = this.settings.get_string('ddcutil-binary-path');
            const displayNames = [];
            /*
                due to spawnWithCallback fetching faster information for second display in list before first one
                there is a situation where name is displayed for first device but controls second device.

                To fix that, we define our own id inside the loop, which is used to detect right device.
            */
            let displayLoopId = 0;
            brightnessLog(this.settings, `ddcutil brief info:\n${ddcutilBriefInfo}`);
            const sleepMultiplier = this.settings.get_double('ddcutil-sleep-multiplier') / 40;
            ddcutilBriefInfo.split('\n').map(ddcLine => {
                if (ddcLine.indexOf('/dev/i2c-') !== -1) {
                    brightnessLog(this.settings, `ddcutil brief info found bus line:\n ${ddcLine}`);
                    /* I2C bus comes first, so when that is detect start a new display object */
                    const displayBus = ddcLine.split('/dev/i2c-')[1].trim();
                    /* save displayLoopId as a const for rest of the async calls below here*/
                    const displayId = displayLoopId;
                    /* check if display is on or not */
                    brightnessLog(this.settings, `ddcutil reading display state for bus: ${displayBus}`);
                    spawnWithCallback(this.settings, [ddcutilPath, 'getvcp', '--brief', 'D6', '--bus', displayBus, '--sleep-multiplier', sleepMultiplier.toString()], vcpPowerInfos => {
                        brightnessLog(this.settings, `ddcutil reading display status for bus: ${displayBus} is: ${vcpPowerInfos}`);
                        /* only add display to list if ddc communication is supported with the bus*/
                        if (vcpPowerInfos.indexOf('DDC communication failed') === -1 && vcpPowerInfos.indexOf('No monitor detected') === -1) {
                            const vcpPowerInfosArray = filterVCPInfoSpecification(vcpPowerInfos).split(' ')

                            let displayInGoodState = true;
                            if (!this.settings.get_boolean('disable-display-state-check')) {
                                /*
                                    D6 = Power mode
                                    x01 = DPM: On,  DPMS: Off
                                */
                                displayInGoodState = vcpPowerInfosArray.length >= 4 && vcpPowerInfosArray[3] === 'x01';
                            }
                            if (displayInGoodState) {
                                /* read the current and max brightness using getvcp 10 */
                                spawnWithCallback(this.settings, [ddcutilPath, 'getvcp', '--brief', '10', '--bus', displayBus, '--sleep-multiplier', sleepMultiplier.toString()], vcpInfos  => {
                                    if (vcpInfos.indexOf('DDC communication failed') === -1 && vcpInfos.indexOf('No monitor detected') === -1) {
                                        const vcpInfosArray = filterVCPInfoSpecification(vcpInfos).split(' ');
                                        if (vcpInfosArray[2] !== 'ERR' && vcpInfosArray.length >= 5) {
                                            let display = {};

                                            const maxBrightness = vcpInfosArray[4];
                                            /* we need current brightness in the scale of 0 to 1 for slider*/
                                            const currentBrightness = vcpInfosArray[3] / vcpInfosArray[4];

                                            /* make display object */
                                            display = {'bus': displayBus, 'max': maxBrightness, 'current': currentBrightness, 'name': displayNames[displayId]};
                                            displays.push(display);

                                            /* cheap way of making reloading all display slider in the panel */
                                            this.reloadMenuWidgets();
                                        }
                                    }
                                });
                            }
                        }
                    });
                }
                if (ddcLine.indexOf('Monitor:') !== -1) {
                    /* Monitor name comes second in the output,
                     so when that is detected fill the object and push it to list */
                    displayNames[displayLoopId] = ddcLine.split('Monitor:')[1].trim().split(':')[1].trim();
                    displayLoopId++;
                }
            });
        } catch (err) {
            brightnessLog(this.settings, err);
        }
    }

    getDisplaysInfoAsync() {
        const ddcutilPath = this.settings.get_string('ddcutil-binary-path');
        spawnWithCallback(this.settings, [ddcutilPath, 'detect', '--brief'], stdout => {
            this.parseDisplaysInfoAndAddToPanel(stdout);
        });
    }

    getCachedDisplayInfoAsync() {
        const file = Gio.File.new_for_path(ddcutilDetectCacheFile);
        const cancellable = new Gio.Cancellable();
        file.load_contents_async(cancellable, (source, result) => {
            try {
                const [ok, contents, etagOut] = source.load_contents_finish(result);
                const decoder = new TextDecoder('utf-8');
                this.parseDisplaysInfoAndAddToPanel(decoder.decode(contents));
            } catch (e) {
                brightnessLog(this.settings, `${ddcutilDetectCacheFile} cache file reading error`);
            }
        });
        spawnWithCallback(this.settings, ['cat', ddcutilDetectCacheFile], stdout => { });
    }

    settingsToJSObject() {
        const out = {
            'allow-zero-brightness': this.settings.get_boolean('allow-zero-brightness'),
            'disable-display-state-check': this.settings.get_boolean('disable-display-state-check'),
            'hide-system-indicator': this.settings.get_boolean('hide-system-indicator'),
            'only-all-slider': this.settings.get_boolean('only-all-slider'),
            'show-all-slider': this.settings.get_boolean('show-all-slider'),
            'show-display-name': this.settings.get_boolean('show-display-name'),
            'show-value-label': this.settings.get_boolean('show-value-label'),
            'verbose-debugging': this.settings.get_boolean('verbose-debugging'),
            'ddcutil-queue-ms': this.settings.get_double('ddcutil-queue-ms'),
            'ddcutil-sleep-multiplier': this.settings.get_double('ddcutil-sleep-multiplier'),
            'position-system-indicator': this.settings.get_double('position-system-indicator'),
            'position-system-menu': this.settings.get_double('position-system-menu'),
            'step-change-keyboard': this.settings.get_double('step-change-keyboard'),
            'button-location': this.settings.get_int('button-location'),
            'ddcutil-additional-args': this.settings.get_string('ddcutil-additional-args'),
            'ddcutil-binary-path': this.settings.get_string('ddcutil-binary-path'),
            'decrease-brightness-shortcut': this.settings.get_strv('decrease-brightness-shortcut'),
            'increase-brightness-shortcut': this.settings.get_strv('increase-brightness-shortcut'),
        };
        return out;
    }

    onSettingsChange() {
        brightnessLog(this.settings, 'this.settings change detected, reloading widgets');
        this.removeKeyboardShortcuts();
        this.addKeyboardShortcuts();
        this.reloadMenuWidgets();
        if (this.settings.get_boolean('verbose-debugging'))
            brightnessLog(this.settings, JSON.stringify(this.settingsToJSObject()));

        const writeCollectorWaitMs = parseInt(this.settings.get_double('ddcutil-queue-ms'));
        Object.keys(writeCollection).forEach(displayBus => {
            writeCollection[displayBus].countdown = writeCollectorWaitMs;
            if (writeCollection[displayBus].interval !== null)
                clearInterval(writeCollection[displayBus].interval);

            writeCollection[displayBus].interval = null;
        });
    }

    onMonitorChange() {
        /*
            when monitor change happens,
            sometimes the turned off monitor is still accepting DDC connection
            this is not a great fix, because some monitor
            will still take longer than 5 seconds to be off
        */
        brightnessLog(this.settings, 'Monitor change detected, reloading extension in 5 seconds.');
        if (monitorChangeTimeout !== null)
            clearTimeout(monitorChangeTimeout);

        monitorChangeTimeout = setTimeout(() => {
            monitorChangeTimeout = null;
            this.reloadExtension();
        }, 5000);
    }

    connectSettingsSignals() {
        oldSettings = this.settings;
        settingsSignals = {
            change: this.settings.connect('changed', () => {
                this.onSettingsChange();
            }),
            reload: this.settings.connect('changed::reload', () => {
                this.reloadExtension();
            }),
            indicator: this.settings.connect('changed::button-location', () => {
                this.reloadExtension();
            }),
            hide_system_indicator: this.settings.connect('changed::hide-system-indicator', () => {
                this.reloadExtension();
            }),
            position_system_indicator: this.settings.connect('changed::position-system-indicator', () => {
                this.moveIndicator();
            }),
            position_system_menu: this.settings.connect('changed::position-system-menu', () => {
                this.reloadExtension();
            }),
            disable_display_state_check: this.settings.connect('changed::disable-display-state-check', () => {
                this.reloadExtension();
            }),
            verbose_debugging: this.settings.connect('changed::verbose-debugging', () => {
                this.reloadExtension();
            }),
        };
    }

    connectMonitorChangeSignals() {
        monitorSignals = {
            change: Main.layoutManager.connect('monitors-changed', this.onMonitorChange.bind(this)),
        };
    }

    disconnectSettingsSignals() {
        Object.values(settingsSignals).forEach(signal => {
            oldSettings.disconnect(signal);
        });
        settingsSignals = {};
        oldSettings = null;
    }

    disconnectMonitorSignals() {
        Main.layoutManager.disconnect(monitorSignals.change);
    }

    addAllDisplaysToPanel() {
        try {
            if (GLib.file_test(ddcutilDetectCacheFile, GLib.FileTest.IS_REGULAR))
                this.getCachedDisplayInfoAsync();
            else
                this.getDisplaysInfoAsync();
        } catch (err) {
            brightnessLog(this.settings, err);
        }
    }

    increase() {
        brightnessLog(this.settings, 'Increase brightness');
        mainMenuButton.emit('value-up');
    }

    decrease() {
        brightnessLog(this.settings, 'Decrease brightness');
        mainMenuButton.emit('value-down');
    }

    addKeyboardShortcuts() {
        brightnessLog(this.settings, 'Add keyboard shortcuts');
        Main.wm.addKeybinding(
            'increase-brightness-shortcut',
            this.settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            this.increase.bind(this)
        );
        Main.wm.addKeybinding(
            'decrease-brightness-shortcut',
            this.settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            this.decrease.bind(this)
        );
    }

    removeKeyboardShortcuts() {
        brightnessLog(this.settings, 'Remove keyboard shortcuts');
        Main.wm.removeKeybinding('increase-brightness-shortcut');
        Main.wm.removeKeybinding('decrease-brightness-shortcut');
    }
}
