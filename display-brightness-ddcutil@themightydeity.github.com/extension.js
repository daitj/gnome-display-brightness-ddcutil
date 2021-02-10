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
const { Clutter, GObject, St } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();


// for shell command
const GLib = imports.gi.GLib;

//io
const Gio = imports.gi.Gio;

// for settings
const Convenience = Me.imports.convenience;
settings = Convenience.getSettings();

// icons and labels
const Lang = imports.lang;

// menu items
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;

const SHOW_ALL_SLIDER = 'show-all-slider';


let brightnessIcon = 'display-brightness-symbolic';

/* lowest possible value for brightness */
const minBrightness = 1;

/* when should min brightness value should be used */
const minBrightnessThreshold = 5;

const displays = [];


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

//timer
/**
 * Taken from: https://github.com/optimisme/gjs-examples/blob/master/assets/timers.js
 */
const setTimeout = function(func, millis /* , ... args */ ) {

    let args = [];
    if (arguments.length > 2) {
        args = args.slice.call(arguments, 2);
    }

    let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, millis, () => {
        func.apply(null, args);
        return GLib.SOURCE_REMOVE;; // Stop repeating
    });

    return id;
};

const clearTimeout = function(id) {
    GLib.source_remove(id);
};

class Extension {
    constructor() {}

    enable() {
        SliderPanelMenu("enable")
    }

    disable() {
        SliderPanelMenu("disable")
    }
}

function init() {
    return new Extension();
}

function spawnCommandAndRead(command_line) {
    try {
        let stuff = ByteArray.toString(GLib.spawn_command_line_sync(command_line)[1]);
        return stuff;
    } catch (err) {
        return null;
    }
}

function spawnWithCallback(argv, callback) {
    let proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);

    proc.communicate_utf8_async(null, null, (proc, res) => {
        let [ok, stdout, stderr] = proc.communicate_utf8_finish(res);

        if (proc.get_successful()) {
            callback(stdout);
        }
    });
}

const SliderMenuItem = GObject.registerClass({
    GType: 'SliderMenuItem'
}, class SliderMenuItem extends PopupMenu.PopupMenuItem {
    _init(slider) {
        super._init("");
        this.add_child(slider);
    }
});

const SliderPanelMenuButton = GObject.registerClass({
    GType: 'SliderPanelMenuButton'
}, class SliderPanelMenuButton extends PanelMenu.Button {
    _init() {
        super._init(0.0);
        let icon = new St.Icon({ icon_name: brightnessIcon, style_class: 'system-status-icon' });
        this.add_actor(icon);
    }
    removeAllMenu() {
        this.menu.removeAll();
    }
    addMenuItem(item, position = null) {
        this.menu.addMenuItem(item);
    }
});

class SliderItem extends PopupMenu.PopupMenuSection {
    constructor(displayName, currentValue, onSliderChange) {
        super();
        this._timer = null
        this._displayName = displayName
        this._currentValue = currentValue
        this._onSliderChange = onSliderChange
        this._init();
    }
    _init() {
        this.NameContainer = new PopupMenu.PopupMenuItem(this._displayName, { hover: false, reactive: false, can_focus: false });

        this.ValueSlider = new Slider.Slider(this._currentValue);
        this.ValueSlider.connect('notify::value', Lang.bind(this, this._SliderChange));

        this.SliderContainer = new SliderMenuItem(this.ValueSlider);

        // add Slider to it
        this.addMenuItem(this.NameContainer);
        this.addMenuItem(this.SliderContainer);
        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }
    changeValue(newValue) {
        this.ValueSlider.value = newValue / 100;
    }
    _SliderChange() {
        let sliderItem = this
        if (sliderItem.timer) {
            clearTimeout(sliderItem.timer);
        }
        sliderItem.timer = setTimeout(() => {
            let sliderval = Math.floor(sliderItem.ValueSlider.value * 100);
            sliderItem._onSliderChange(sliderval)
        }, 500)
    }
}

function setBrightness(display, newValue) {
    let newBrightness = parseInt((newValue / 100) * display.max);
    if (newBrightness <= minBrightnessThreshold) {
        newBrightness = minBrightness;
    }
    //log(display.name, newValue, newBrightness);
    GLib.spawn_command_line_async(`${ddcutil_path} setvcp 10 ${newBrightness} --bus ${display.bus}`)
}

function setAllBrightness(newValue) {
    displays.forEach(element => {
        element.slider.changeValue(newValue);
        setBrightness(element, newValue);
    });
}

function addSettingsItem(panel) {
    let settingsItem = new PopupMenu.PopupMenuItem("Settings");
    settingsItem.connect('activate', openPrefs);
    panel.addMenuItem(settingsItem, 3);
}

function addAllSlider(panel) {
     let onSliderChange = function(newValue) {
        setAllBrightness(newValue);
     }
    let allslider = new SliderItem("All", displays[0].current, onSliderChange);
    panel.addMenuItem(allslider, 0)
}

function reloadMenuWidgets(panel) {
    panel.removeAllMenu();
    for(var i = 0; i < displays.length; i++) {
        addDisplayToPanel(displays[i], panel, i+1, displays.length);
    }
}

function addDisplayToPanel(display, panel, display_count, max_display_cnt) {
    if (display_count == 1) {
        //remove all text info before adding first display
        panel.removeAllMenu();
        if(settings.get_boolean(SHOW_ALL_SLIDER)) {
            addAllSlider(panel);
        }

    }
     let onSliderChange = function(newValue) {
        setBrightness(display, newValue)
    }

    let displaySlider = new SliderItem(display.name, display.current, onSliderChange);
    display.slider = displaySlider;
    panel.addMenuItem(displaySlider, display_count);
    if (display_count == max_display_cnt){
        addSettingsItem(panel);
    }

}


function addTextItemToPanel(text, panel) {
    let menuItem = new PopupMenu.PopupMenuItem(text, {
        reactive: false
    });
    panel.addMenuItem(menuItem);
}

function addItemToPanel(text, panel) {
  let menuItem = new PopupMenu.PopupMenuItem(text);
  panel.addMenuItem(menuItem);
  return menuItem;
}

function parseDisplaysInfoAndAddToPanel(ddcutil_brief_info, panel) {
    try {
        let display_names = [];
        let num_devices = (ddcutil_brief_info.match(new RegExp("/dev/i2c-", "g")) || []).length;
        ddcutil_brief_info.split('\n').map(ddc_line => {
            if (ddc_line.indexOf("/dev/i2c-") !== -1) {
                /* I2C bus comes first, so when that is detect start a new display object */
                let display_bus = ddc_line.split("/dev/i2c-")[1].trim();
                /* read the current and max brightness using getvcp 10 */
                spawnWithCallback([ddcutil_path, "getvcp", "--brief", "10", "--bus", display_bus], function(vcpInfos) {
                    let display = {};
                    let ddc_supported = true;
                    if (vcpInfos.indexOf("DDC communication failed") !== -1) {
                        ddc_supported = false;
                    } else {
                        ddc_supported = true;
                    }
                    let vcpInfosArray = vcpInfos.trim().split(" ");
                    let maxBrightness = vcpInfosArray[4];
                    /* we need current brightness in the scale of 0 to 1 for slider*/
                    let currentBrightness = vcpInfosArray[3] / vcpInfosArray[4];

                    /* make display object */
                    display = { "bus": display_bus, "max": maxBrightness, "current": currentBrightness, "supported": ddc_supported, "name": display_names[displays.length]};
                    displays.push(display);
                    addDisplayToPanel(display, panel, displays.length, num_devices);
                    });
            }
            if (ddc_line.indexOf("Monitor:") !== -1) {
                /* Monitor name comes second in the output,
                 so when that is detected fill the object and push it to list */
                display_names.push(ddc_line.split("Monitor:")[1].trim().split(":")[1].trim())
            }
        });
    } catch (err) {
        log(err);
    }
}

function getDisplaysInfoAsync(panel) {
    spawnWithCallback([ddcutil_path, "detect", "--brief"], function(stdout) {
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
            log(`${ddcutil_detect_cache_file} cache file reading error`)
        }
    });
    spawnWithCallback(["cat", ddcutil_detect_cache_file], function(stdout) {});
}

let panelmenu;
let timeoutId = null;

function setEnableSlider(panel) {
    reloadMenuWidgets(panel);
}

function SliderPanelMenu(set) {
    if (set == "enable") {
        panelmenu = new SliderPanelMenuButton();
        Main.panel.addToStatusArea("DDCUtilBrightnessSlider", panelmenu, 0, "right");

        settings.connect('changed',function(){ setEnableSlider(panelmenu)});
        
        timeoutId = setTimeout(function() {
            timeoutId = null;
            if (panelmenu) {
                addTextItemToPanel("Initializing", panelmenu);
                try {
                    if (GLib.file_test(ddcutil_detect_cache_file, (GLib.FileTest.IS_REGULAR))) {
                        getCachedDisplayInfoAsync(panelmenu);
                    } else {
                        getDisplaysInfoAsync(panelmenu);
                    }
                } catch (err) {
                    log(err);
                }
            }
        }, 1);

    } else if (set == "disable") {
        panelmenu.destroy();
        panelmenu = null;
        if (timeoutId) {
            clearTimeout(timeoutId)
        }
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
