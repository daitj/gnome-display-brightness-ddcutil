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

let panelmenu, icon;
let brightnessIcon = 'display-brightness-symbolic';

/* lowest possible value for brightness */
const minBrightness = 1;

/* when should min brightness value should be used */
const minBrightnessThreshold = 5;



//timer
/**
 * Taken from: https://github.com/optimisme/gjs-examples/blob/master/assets/timers.js
 */
const Mainloop = imports.mainloop;
const setTimeout = function(func, millis /* , ... args */ ) {

    let args = [];
    if (arguments.length > 2) {
        args = args.slice.call(arguments, 2);
    }

    let id = Mainloop.timeout_add(millis, () => {
        func.apply(null, args);
        return false; // Stop repeating
    }, null);

    return id;
};

const clearTimeout = function(id) {

    Mainloop.source_remove(id);
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
        icon = new St.Icon({ icon_name: brightnessIcon, style_class: 'system-status-icon' });
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
    GLib.spawn_command_line_async("ddcutil setvcp 10 " + newBrightness + " --nodetect --bus " + display.bus)
}

function addDisplayToPanel(display, panel) {
    let onSliderChange = function(newValue) {
        setBrightness(display, newValue)
    };
    let displaySlider = new SliderItem(display.name, display.current, onSliderChange)
    panel.addMenuItem(displaySlider);
}

function noDisplayFound(panel) {
    let noDisplayFound = new PopupMenu.PopupMenuItem("ddcutil didn't find any display\nwith DDC/CI support.", {
        reactive: false
    });
    panel.addMenuItem(noDisplayFound);
}

function onDisplayBriefInfo(args, stdout, result) {
    let [panel, first, display, ddc_supported] = args
    try {
        let ddc_line = stdout.read_line_finish(result)[0];
        // %null generally means end of stream
        if (ddc_line !== null) {
            ddc_line = ddc_line.toString()
            if (ddc_line.indexOf("/dev/i2c-") !== -1) {
                /* I2C bus comes first, so when that is detect start a new display object */
                let display_bus = ddc_line.split("/dev/i2c-")[1].trim();
                /* read the current and max brightness using getvcp 10 */
                let vcpInfos = spawnCommandAndRead("ddcutil getvcp --nodetect --brief 10 --bus " + display_bus);
                if (vcpInfos.indexOf("DDC communication failed") !== -1) {
                    ddc_supported = false;
                    //reset display object, as old one will be skipped
                    display = {};
                } else {
                    ddc_supported = true;
                }
                let vcpInfosArray = vcpInfos.trim().split(" ");
                let maxBrightness = vcpInfosArray[4];
                /* we need current brightness in the scale of 0 to 1 for slider*/
                let currentBrightness = vcpInfosArray[3] / vcpInfosArray[4];

                /* make display object */
                display = { "bus": display_bus, "max": maxBrightness, "current": currentBrightness };
            }
            if (ddc_line.indexOf("Monitor:") !== -1 && ddc_supported) {
                /* Monitor name comes second in the output,
                 so when that is detected fill the object and push it to list */
                if (display["bus"] !== "") {
                    display["name"] = ddc_line.split("Monitor:")[1].trim().split(":")[1].trim()
                }
                if (first) {
                    // clear anything there is already
                    panel.removeAllMenu()
                    first = false;
                }
                // add newly made display object to panel
                addDisplayToPanel(display, panel);
                //prep for new display
                display = {};
                ddc_supported = false;
            }
            // Now you can request the next line
            stdout.read_line_async(GLib.PRIORITY_DEFAULT, null, onDisplayBriefInfo.bind(this, [panel, first, display, ddc_supported]));
        } else {
            if (first) {
                panel.removeAllMenu();
                //is first and still no display has been added yet
                noDisplayFound(panel);
            }
        }
    } catch (e) {
        global.log("Error " + e);
    }
}

async function getDisplayBriefInfo(panel) {
    let [success, argv] = GLib.shell_parse_argv("sh -c '" + "ddcutil detect --brief" + "'");
    if (success) {
        let [exit, pid, fd_stdin, fd_stdout, stderr] =
        GLib.spawn_async_with_pipes(
            null,
            argv,
            null,
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
            null
        );
        let out_reader = new Gio.DataInputStream({
            base_stream: new Gio.UnixInputStream({ fd: fd_stdout })
        });
        out_reader.read_line_async(GLib.PRIORITY_DEFAULT, null, onDisplayBriefInfo.bind(this, [panel, true, {}, false]));
    } else {
        throw new Error("Invalid command passed");
    }
}

async function getAndPaintDisplays(panel) {
    let readingDisplays = new PopupMenu.PopupMenuItem("Reading...", {
        reactive: false
    });
    panel.addMenuItem(readingDisplays);
    try {
        getDisplayBriefInfo(panel);
    } catch (error) {
        global.log(error)
    }
}

function SliderPanelMenu(set) {
    if (set == "enable") {
        panelmenu = new SliderPanelMenuButton()
        Main.panel.addToStatusArea("DDCUtilBrightnessSlider", panelmenu, 0, "right");
        getAndPaintDisplays(panelmenu);
    } else if (set == "disable") {
        panelmenu.destroy();
        panelmenu = null;
        icon = null;
    }
}