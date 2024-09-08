import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

// menu items
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import * as Convenience from './convenienceExt.js';

const {
    brightnessLog,
} = Convenience;

function decycle(obj, stack = []) {
    if (!obj || typeof obj !== 'object')
        return obj;

    if (stack.includes(obj))
        return null;

    const s = stack.concat([obj]);

    return Array.isArray(obj)
        ? obj.map(x => decycle(x, s))
        : Object.fromEntries(
            Object.entries(obj)
                .map(([k, v]) => [k, decycle(v, s)]));
}


function sliderKeyUpDownEvent(actor, scrollStep) {
    actor.getStoredSliders().forEach(slider => {
        slider.setShowOSD();
        slider.ValueSlider.value = Math.min(Math.max(0, slider.ValueSlider.value + scrollStep), slider.ValueSlider._maxValue);
        slider.setHideOSD();
    });
}
function sliderScrollEvent(actor, event) {
    actor.getStoredSliders().forEach(slider => {
        slider.setShowOSD();
        slider.ValueSlider.emit('scroll-event', event);
        slider.setHideOSD();
    });
    return Clutter.EVENT_STOP;
}
function sliderValueChangeCommon(item) {
    const brightness = item._SliderValueToBrightness(item.ValueSlider.value);
    item.ValueLabel.text = brightness.toString();
    item.emit('slider-change', brightness);
    if (item._onSliderChange)
        item._onSliderChange(item, brightness);

    if (item._settings.get_boolean('show-osd') && !item._hideOSD) {
        let displayName = null;
        if (item._settings.get_boolean('show-display-name'))
            displayName = item.displayName;

        let osdLabel = displayName;
        if (item._settings.get_boolean('show-value-label')) {
            if (displayName !== null)
                osdLabel = `${displayName} ${brightness}`;
            else
                osdLabel = `${brightness}`;
        }
        Main.osdWindowManager.show(-1, new Gio.ThemedIcon({name: 'display-brightness-symbolic'}), osdLabel, item.ValueSlider.value, 1);
    }
}
export const StatusAreaBrightnessMenu = GObject.registerClass({
    GType: 'StatusAreaBrightnessMenu',
    Signals: {'value-up': {}, 'value-down': {}},
}, class StatusAreaBrightnessMenu extends PanelMenu.Button {
    _init(settings) {
        this._sliders = [];
        super._init(0.0);
        this._icon = new St.Icon({icon_name: 'display-brightness-symbolic', style_class: 'system-status-icon'});
        this._iconVisible = true;
        this.add_child(this._icon);
        this.connect('scroll-event', sliderScrollEvent);
        this.connect('value-up', (actor, event) => {
            sliderKeyUpDownEvent(actor, settings.get_double('step-change-keyboard') / 100);
            return Clutter.EVENT_STOP;
        });
        this.connect('value-down', (actor, event) => {
            sliderKeyUpDownEvent(actor, -settings.get_double('step-change-keyboard') / 100);
            return Clutter.EVENT_STOP;
        });
    }

    indicatorVisibility(visible) {
        if (!visible && this._iconVisible) {
            this.remove_child(this._icon);
            this._iconVisible = false;
        } else if (visible && !this._iconVisible) {
            this.add_child(this._icon);
            this._iconVisible = true;
        }
    }

    clearStoredSliders() {
        this._sliders = [];
    }

    storeSliderForEvents(slider) {
        this._sliders.push(slider);
    }

    getStoredSliders() {
        return this._sliders;
    }

    removeAllMenu() {
        this.menu.removeAll();
    }

    addMenuItem(item, position = null) {
        this.menu.addMenuItem(item);
    }
});

export const SystemMenuBrightnessMenu = GObject.registerClass({
    GType: 'SystemMenuBrightnessMenu',
    Signals: {'value-up': {}, 'value-down': {}},
}, class SystemMenuBrightnessMenu extends QuickSettings.SystemIndicator {
    _init(settings) {
        super._init();
        this._sliders = [];
        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'display-brightness-symbolic';
        this._indicator.visible = !settings.get_boolean('hide-system-indicator');
        this.connect('scroll-event', sliderScrollEvent);
        this.connect('value-up', (actor, event) => {
            sliderKeyUpDownEvent(actor, settings.get_double('step-change-keyboard') / 100);
            return Clutter.EVENT_STOP;
        });
        this.connect('value-down', (actor, event) => {
            sliderKeyUpDownEvent(actor, -settings.get_double('step-change-keyboard') / 100);
            return Clutter.EVENT_STOP;
        });
        this.connect('destroy', this._onDestroy.bind(this));
        this._settings = settings;
    }

    indicatorVisibility(visible) {
        if (!this._settings.get_boolean('hide-system-indicator'))
            this._indicator.visible = visible;
        else
            this._indicator.visible = false;
    }

    removeAllMenu() {
        /* Remove all quick settings items by destroying */
        this.quickSettingsItems.forEach(item => item.destroy());
        this.quickSettingsItems = [];
    }

    addMenuItem(item, position = null) {
        this.quickSettingsItems.push(item);
    }

    clearStoredSliders() {
        this._sliders = [];
    }

    storeSliderForEvents(slider) {
        this._sliders.push(slider);
    }

    getStoredSliders() {
        return this._sliders;
    }

    _onDestroy() {
        brightnessLog(this._settings, 'Destroy all quick settings items');
        this.quickSettingsItems.forEach(item => item.destroy());
    }
});

export const SingleMonitorMenuItem = GObject.registerClass({
    GType: 'SingleMonitorMenuItem',
}, class SingleMonitorMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(settings, icon, name, slider, label) {
        super._init();
        if (icon != null)
            this.add_actor(icon);

        if (name != null && settings.get_boolean('show-display-name'))
            this.add_child(name);

        this.add_child(slider);

        if (settings.get_boolean('show-value-label'))
            this.add_child(label);
    }
});

export const SingleMonitorSliderAndValueForStatusAreaMenu = class SingleMonitorSliderAndValue extends PopupMenu.PopupMenuSection {
    constructor(settings, displayName, currentValue, onSliderChange) {
        super();
        this._settings = settings;
        this._displayName = displayName;
        this._currentValue = currentValue;
        this._onSliderChange = onSliderChange;
        /* OSD is never shown by default */
        this._hideOSD = true;
        this.__hideOSDBackup = true;
        this._init();
    }

    _init() {
        this.NameContainer = new PopupMenu.PopupMenuItem(this._displayName, {
            hover: false,
            reactive: false,
            can_focus: false,
        });
        this.ValueSlider = new Slider(this._currentValue);
        this.ValueSlider.connect('notify::value', this._SliderChange.bind(this));
        this.ValueLabel = new St.Label({text: this._SliderValueToBrightness(this._currentValue).toString()});
        const valueSliderBin = new St.Bin({
            style_class: 'display-brightness-ddcutil-monitor-slider-bin-system-menu',
            child: this.ValueSlider,
            reactive: true,
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.SliderContainer = new SingleMonitorMenuItem(this._settings, null, null, valueSliderBin, this.ValueLabel);
        if (this._settings.get_boolean('show-display-name'))
            this.addMenuItem(this.NameContainer);

        this.addMenuItem(this.SliderContainer);
        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    setHideOSD() {
        this.__hideOSDBackup = this._hideOSD;
        this._hideOSD = true;
    }

    setShowOSD() {
        this.__hideOSDBackup = this._hideOSD;
        this._hideOSD = false;
    }

    resetOSD() {
        this._hideOSD = this.__hideOSDBackup;
    }

    changeValue(newValue) {
        this.ValueSlider.value = newValue / 100;
    }

    _SliderValueToBrightness(sliderValue) {
        return Math.floor(sliderValue * 100);
    }

    _SliderChange() {
        sliderValueChangeCommon(this);
    }
};

export const SingleMonitorSliderAndValueForQuickSettingsSubMenu = GObject.registerClass({
    GType: 'SingleMonitorSliderAndValueForQuickSettingsSubMenu',
    Properties: {
        'settings': GObject.ParamSpec.object('settings', 'settings', 'settings',
            GObject.ParamFlags.READWRITE,
            Gio.Settings),
        'display-name': GObject.ParamSpec.string('display-name', 'display-name', 'display-name',
            GObject.ParamFlags.READWRITE,
            ''),
        'current-value': GObject.ParamSpec.double('current-value', 'current-value', 'current-value',
            GObject.ParamFlags.READWRITE,
            0, 1, 1),
    },
    Signals: {
        'slider-change': {
            param_types: [GObject.TYPE_DOUBLE],
        },
    },
}, class SingleMonitorSliderAndValueForQuickSettingsSubMenu extends PopupMenu.PopupImageMenuItem {
    _init(params) {
        super._init(
            "", 'display-brightness-symbolic', {}
        );
        this.settings = params.settings
        this.display_name = params['display-name']
        this.current_value = params['current-value']

        /* OSD is never shown by default */
        this._hideOSD = true;
        this.__hideOSDBackup = true;

        //if (this.settings.get_boolean('show-display-name'))
        //    this.label.text = this.display_name;

        this.ValueSlider = new Slider(this.current_value);
        this.ValueSlider.connect('notify::value', this._SliderChange.bind(this));
        this.NameContainer = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            text: this.display_name,
            style: 'font-size: 10px; font-weight: normal;',
            style_class: 'display-brightness-ddcutil-monitor-name-system-menu',
        });
        if (this.settings.get_boolean('show-display-name'))
            this.add_child(this.NameContainer);
        this.ValueLabel = new St.Label({text: this._SliderValueToBrightness(this.current_value).toString()});
        this.add_child(this.ValueSlider);

        /* for compatibility in other places */
        this._settings = this.settings;
        this.displayName = this.display_name;

        if (this.settings.get_boolean('show-value-label'))
            this.add_child(this.ValueLabel);
    }

    setHideOSD() {
        this.__hideOSDBackup = this._hideOSD;
        this._hideOSD = true;
    }

    setShowOSD() {
        this.__hideOSDBackup = this._hideOSD;
        this._hideOSD = false;
    }

    resetOSD() {
        this._hideOSD = this.__hideOSDBackup;
    }

    changeValue(newValue) {
        this.ValueSlider.value = newValue / 100;
    }

    _SliderValueToBrightness(sliderValue) {
        return Math.floor(sliderValue * 100);
    }

    _SliderChange() {
        sliderValueChangeCommon(this);
    }
});



export const SingleMonitorSliderAndValueForQuickSettings = GObject.registerClass({
    GType: 'SingleMonitorSliderAndValueForQuickSettings',
    Properties: {
        'settings': GObject.ParamSpec.object('settings', 'settings', 'settings',
            GObject.ParamFlags.READWRITE,
            Gio.Settings),
        'display-name': GObject.ParamSpec.string('display-name', 'display-name', 'display-name',
            GObject.ParamFlags.READWRITE,
            ''),
        'current-value': GObject.ParamSpec.double('current-value', 'current-value', 'current-value',
            GObject.ParamFlags.READWRITE,
            0, 1, 1),
    },
    Signals: {
        'slider-change': {
            param_types: [GObject.TYPE_DOUBLE],
        },
    },
}, class SingleMonitorSliderAndValueForQuickSettings extends QuickSettings.QuickSlider {
    _init(params) {
        super._init({
            ...params,
            iconName: 'display-brightness-symbolic',
        });
        /* OSD is never shown by default */
        this._hideOSD = true;
        this.__hideOSDBackup = true;

        this.slider.value = this.current_value;
        this.slider.connect('notify::value', this._SliderChange.bind(this));
        this.slider.accessible_name = this.display_name;
        this.NameContainer = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            text: this.display_name,
            style: 'font-size: 12px; font-weight: normal;',
            style_class: 'display-brightness-ddcutil-monitor-name-system-menu',
        });
        this.ValueLabel = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 12px; font-weight: normal;',
            text: this._SliderValueToBrightness(this.current_value).toString(),
        });
        /* for compatibility in other places */
        this.ValueSlider = this.slider;
        this._settings = this.settings;
        this.displayName = this.display_name;
    }

    setHideOSD() {
        this.__hideOSDBackup = this._hideOSD;
        this._hideOSD = true;
    }

    setShowOSD() {
        this.__hideOSDBackup = this._hideOSD;
        this._hideOSD = false;
    }

    resetOSD() {
        this._hideOSD = this.__hideOSDBackup;
    }

    changeValue(newValue) {
        this.slider.value = newValue / 100;
    }

    _SliderValueToBrightness(sliderValue) {
        return Math.floor(sliderValue * 100);
    }

    _SliderChange() {
        sliderValueChangeCommon(this);
    }
});
