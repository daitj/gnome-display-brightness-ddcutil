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

// for shell command 
const GLib = imports.gi.GLib;

//io
const Gio = imports.gi.Gio;

// icons and labels
const Lang = imports.lang;

// menu items
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;

let brightnessIcon = 'display-brightness-symbolic';

/* lowest possible value for brightness */
const minBrightness = 1;

/* when should min brightness value should be used */
const minBrightnessThreshold = 5;

/*  
    instead of reading i2c bus everytime during startup, 
    as it is unlikely that bus number changes, we can read
    cache file instead.
    one can make this file by running following shell command:
    ddcutil --brief detect > ~/.cache/ddcutil_detect
*/
const ddcutil_detect_cache_file = "~/.cache/ddcutil_detect";

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
    }, null);

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
    let env = GLib.get_environ();
    let [success, pid, stdinFile, stdoutFile, stderrFile] = GLib.spawn_async_with_pipes(
        null, argv, env, 0, null);

    if (!success)
        return;

    GLib.close(stdinFile);
    GLib.close(stderrFile);

    let standardOutput = "";

    let stdoutStream = new Gio.DataInputStream({
        base_stream: new Gio.UnixInputStream({
            fd: stdoutFile
        })
    });

    readStream(stdoutStream, function(output) {
        if (output === null) {
            stdoutStream.close(null);
            callback(standardOutput);
        } else {
            standardOutput += output;
        }
    });
}

function readStream(stream, callback) {
    stream.read_line_async(GLib.PRIORITY_LOW, null, function(source, result) {
        let [line] = source.read_line_finish(result);

        if (line === null) {
            callback(null);
        } else {
            callback(imports.byteArray.toString(line) + "\n");
            readStream(source, callback);
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
    addMenuItem(item) {
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
    global.log(display.name, newValue, newBrightness)
    GLib.spawn_command_line_async(`${ddcutil_path} setvcp 10 ${newBrightness} --nodetect --bus ${display.bus}`)
}

function addDisplayToPanel(display, panel, display_count) {
    if (display_count == 1) {
        //remove all text info before adding first display
        panel.removeAllMenu()
    }
    let onSliderChange = function(newValue) {
        setBrightness(display, newValue)
    };
    let displaySlider = new SliderItem(display.name, display.current, onSliderChange)
    panel.addMenuItem(displaySlider);
}

function addTextItemToPanel(text, panel) {
    let menuItem = new PopupMenu.PopupMenuItem(text, {
        reactive: false
    });
    panel.addMenuItem(menuItem);
}

function parseDisplaysInfoAndAddToPanel(ddcutil_brief_info, panel) {
    try {
        let displays = [];
        let display_names = [];
        ddcutil_brief_info.split('\n').map(ddc_line => {
            if (ddc_line.indexOf("/dev/i2c-") !== -1) {
                /* I2C bus comes first, so when that is detect start a new display object */
                let display_bus = ddc_line.split("/dev/i2c-")[1].trim();
                /* read the current and max brightness using getvcp 10 */
                spawnWithCallback([ddcutil_path, "getvcp", "--nodetect", "--brief", "10", "--bus", display_bus], function(vcpInfos) {
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
                    display = { "bus": display_bus, "max": maxBrightness, "current": currentBrightness, "supported": ddc_supported, "name": display_names[displays.length] };
                    displays.push(display);
                    addDisplayToPanel(display, panel, displays.length);
                });
            }
            if (ddc_line.indexOf("Monitor:") !== -1) {
                /* Monitor name comes second in the output,
                 so when that is detected fill the object and push it to list */
                display_names.push(ddc_line.split("Monitor:")[1].trim().split(":")[1].trim())
            }
        });
    } catch (err) {
        global.log(err);
    }
}

function getDisplaysInfoAsync(panel) {
    spawnWithCallback([ddcutil_path, "detect", "--brief"], function(stdout) {
        parseDisplaysInfoAndAddToPanel(stdout, panel)
    });
}


function getCachedDisplayInfoAsync(panel) {
    let file = Gio.File.new_for_path(ddcutil_detect_cache_file)
    let cancellable = new Gio.Cancellable();
    file.load_contents_async(cancellable, (source, result) => {
        try {
            result = source.load_contents_finish(result);
            let [ok, contents, etag_out] = result;
            parseDisplaysInfoAndAddToPanel(contents, panel)
        } catch (e) {
            global.log(`${ddcutil_detect_cache_file} cache file reading error`)
        }
    });
    spawnWithCallback(["cat", ddcutil_detect_cache_file], function(stdout) {});
}

let panelmenu;
let timeoutId = null;

function SliderPanelMenu(set) {
    if (set == "enable") {
        panelmenu = new SliderPanelMenuButton()
        Main.panel.addToStatusArea("DDCUtilBrightnessSlider", panelmenu, 0, "right");
        timeoutId = setTimeout(function() {
            timeoutId = null;
            if (panelmenu) {
                addTextItemToPanel("Initializing", panelmenu);
                try {
                    if (GLib.file_test(ddcutil_detect_cache_file, GLib.FileTest.IS_REGULAR)) {
                        getCachedDisplayInfoAsync(panelmenu);
                    } else {
                        getDisplaysInfoAsync(panelmenu);
                    }
                } catch (err) {
                    global.log(err);
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