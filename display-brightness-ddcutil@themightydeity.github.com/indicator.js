const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const { Gio, GObject, St, Clutter } = imports.gi;

// menu items
const Main = imports.ui.main;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu
const PopupMenu = imports.ui.popupMenu;
const { Slider } = imports.ui.slider;

const {
    brightnessLog
} = Me.imports.convenience;

const Convenience = Me.imports.convenience;

function decycle(obj, stack = []) {
    if (!obj || typeof obj !== 'object')
        return obj;

    if (stack.includes(obj))
        return null;

    let s = stack.concat([obj]);

    return Array.isArray(obj)
        ? obj.map(x => decycle(x, s))
        : Object.fromEntries(
            Object.entries(obj)
                .map(([k, v]) => [k, decycle(v, s)]));
}


function sliderKeyUpDownEvent(actor, scroll_step) {
    actor.getStoredSliders().forEach(slider => {
        slider.setShowOSD()
        slider.ValueSlider.value = Math.min(Math.max(0, slider.ValueSlider.value + scroll_step), slider.ValueSlider._maxValue);
        slider.setHideOSD()
    });
}
function sliderScrollEvent(actor, event) {
    actor.getStoredSliders().forEach(slider => {
        slider.setShowOSD()
        slider.ValueSlider.emit('scroll-event', event);
        slider.setHideOSD()
    });
    return Clutter.EVENT_STOP;
}

var StatusAreaBrightnessMenu = GObject.registerClass({
    GType: 'StatusAreaBrightnessMenu',
    Signals: { 'value-up': {}, 'value-down': {} },
}, class StatusAreaBrightnessMenu extends PanelMenu.Button {
    _init(settings) {
        this._sliders = [];
        super._init(0.0);
        let icon = new St.Icon({ icon_name: 'display-brightness-symbolic', style_class: 'system-status-icon' });
        this.add_actor(icon);
        this.connect('scroll-event', sliderScrollEvent);
        this.connect('value-up', (actor, event) => {
            sliderKeyUpDownEvent(actor, settings.get_double('step-change-keyboard')/100)
            return Clutter.EVENT_STOP;
        });
        this.connect('value-down', (actor, event) => {
            sliderKeyUpDownEvent(actor, -settings.get_double('step-change-keyboard')/100)
            return Clutter.EVENT_STOP;
        });
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

var SystemMenuBrightnessMenu = GObject.registerClass({
    GType: 'SystemMenuBrightnessMenu',
    Signals: { 'value-up': {}, 'value-down': {} },
}, class SystemMenuBrightnessMenu extends PanelMenu.SystemIndicator {
    _init(settings) {
        super._init();
        this._sliders = [];
        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'display-brightness-symbolic';
        this._indicator.visible = !settings.get_boolean('hide-system-indicator');
        this.connect('scroll-event', sliderScrollEvent);
        this.connect('value-up', (actor, event) => {
            sliderKeyUpDownEvent(actor, settings.get_double('step-change-keyboard')/100)
            return Clutter.EVENT_STOP;
        });
        this.connect('value-down', (actor, event) => {
            sliderKeyUpDownEvent(actor, -settings.get_double('step-change-keyboard')/100)
            return Clutter.EVENT_STOP;
        });
        this.connect('destroy', this._onDestroy.bind(this));
    }
    removeAllMenu() {
        this.menu.removeAll()
    }
    addMenuItem(item, position = null) {
        this.menu.addMenuItem(item)
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
        this.menu.destroy();
    }
});

var SingleMonitorMenuItem = GObject.registerClass({
    GType: 'SingleMonitorMenuItem'
}, class SingleMonitorMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(settings, icon, name, slider, label) {
        super._init();
        if (icon != null) {
            this.add_actor(icon);
        }
        if (name != null && settings.get_boolean('show-display-name')) {
            this.add_child(name);
        }
        this.add_child(slider);

        if (settings.get_boolean('show-value-label')) {
            this.add_child(label);
        }
    }
});

var SingleMonitorSliderAndValue = class SingleMonitorSliderAndValue extends PopupMenu.PopupMenuSection {
    constructor(settings, displayName, currentValue, onSliderChange) {
        super();
        this._settings = settings;
        this._timer = null
        this._displayName = displayName
        this._currentValue = currentValue
        this._onSliderChange = onSliderChange
        /* OSD is never shown by default */
        this._hideOSD = true
        this.__hideOSDBackup = true;
        this._init();
    }
    _init() {
        if(this._settings.get_int('button-location') === 0){
            this.NameContainer = new PopupMenu.PopupMenuItem(this._displayName, {
                hover: false,
                reactive: false,
                can_focus: false
            });
        }else{
            this.NameContainer = new St.Label({
                text: this._displayName,
                style_class: 'display-brightness-ddcutil-monitor-name-system-menu'
            });
        }
        
        this.ValueSlider = new Slider(this._currentValue);
        this.ValueSlider.connect('notify::value', this._SliderChange.bind(this));

        this.ValueLabel = new St.Label({ text: this._SliderValueToBrightness(this._currentValue).toString() });

        if (this._settings.get_int('button-location') === 0) {
            this.SliderContainer = new SingleMonitorMenuItem(this._settings, null, null, this.ValueSlider, this.ValueLabel);
            if (this._settings.get_boolean('show-display-name')) {
                this.addMenuItem(this.NameContainer);
            }
        } else {
            let icon = new St.Icon({ icon_name: 'display-brightness-symbolic', style_class: 'popup-menu-icon' });
            this.SliderContainer = new SingleMonitorMenuItem(this._settings, icon, this.NameContainer, this.ValueSlider, this.ValueLabel);
        }
        this.addMenuItem(this.SliderContainer);
        if (this._settings.get_int('button-location') === 0) {
            this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }
    }
    setHideOSD(){
        this.__hideOSDBackup = this._hideOSD;
        this._hideOSD = true;
    }
    setShowOSD(){
        this.__hideOSDBackup = this._hideOSD;
        this._hideOSD = false;
    }
    resetOSD(){
        this._hideOSD = this.__hideOSDBackup;
    }
    changeValue(newValue) {
        this.ValueSlider.value = newValue / 100;
    }
    _SliderValueToBrightness(sliderValue) {
        return Math.floor(sliderValue * 100);
    }
    _SliderChange() {
        this.clearTimeout();
        let brightness = this._SliderValueToBrightness(this.ValueSlider.value);
        let sliderItem = this
        sliderItem.ValueLabel.text = brightness.toString();
        this.timer = Convenience.setTimeout(() => {
            sliderItem.timer = null;
            sliderItem._onSliderChange(brightness)
        }, 500)
        if (sliderItem._settings.get_boolean('show-osd') && !sliderItem._hideOSD) {
            let displayName = null;
            if(sliderItem._settings.get_boolean('show-display-name')){
                displayName = sliderItem._displayName
            }
            Main.osdWindowManager.show(-1, new Gio.ThemedIcon({ name: 'display-brightness-symbolic' }), displayName, sliderItem.ValueSlider.value, 1);
        }
    }
    clearTimeout() {
        if (this.timer) {
            Convenience.clearTimeout(this.timer);
        }
    }
    destory() {
        this.clearTimeout();
    }
}
