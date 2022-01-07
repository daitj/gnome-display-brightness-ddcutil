const { Gio, GObject, Gtk } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const { Headerbar } = Me.imports.headerbar;

const PrefsWidget = GObject.registerClass({
    GTypeName: 'PrefsWidget',
    Template: Me.dir.get_child('./ui/prefs.ui').get_uri(),
    InternalChildren: [
        'show_all_slider_switch',
        'show_value_label_switch',
        'show_display_name_switch',
        'button_location_combo_button',
        'system_menu_revealer',
        'hide_system_indicator_switch',
        'position_system_menu_spin_button',
        'increase_shortcut_entry',
        'decrease_shortcut_entry',
        'increase_shortcut_button',
        'decrease_shortcut_button',
        'allow_zero_brightness_switch',
        'disable_display_state_check_switch'
    ],
}, class PrefsWidget extends Gtk.Box {

    _init(params = {}) {
        super._init(params);
        this.settings = ExtensionUtils.getSettings();

        this.settings.bind(
            'show-all-slider',
            this._show_all_slider_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'show-value-label',
            this._show_value_label_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'show-display-name',
            this._show_display_name_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'button-location',
            this._button_location_combo_button,
            'active-id',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'hide-system-indicator',
            this._hide_system_indicator_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this._position_system_menu_spin_button.value = this.settings.get_double('position-system-menu');

        this.settings.bind(
            'allow-zero-brightness',
            this._allow_zero_brightness_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'disable-display-state-check',
            this._disable_display_state_check_switch,
            'active-id',
            Gio.SettingsBindFlags.DEFAULT
        );

        this._increase_shortcut_entry.text = this.settings.get_strv('increase-brightness-shortcut')[0];
        this._decrease_shortcut_entry.text = this.settings.get_strv('decrease-brightness-shortcut')[0];

        this._increase_shortcut_button.connect('clicked', widget => {
            this.settings.set_strv('increase-brightness-shortcut', [this._increase_shortcut_entry.text]);
        });

        this._decrease_shortcut_button.connect('clicked', widget => {
            this.settings.set_strv('decrease-brightness-shortcut', [this._decrease_shortcut_entry.text]);
        });
    }

    onButtonLocationChanged() {
        if (this._button_location_combo_button.active_id == "menu") {
            this._system_menu_revealer.reveal_child = true;
        } else {
            this._system_menu_revealer.reveal_child = false;
        }
    }

    onValueChanged() {
        this.settings.set_double('position-system-menu', this._position_system_menu_spin_button.value);
    }

}
);

function init() {
    ExtensionUtils.initTranslations();
}

function buildPrefsWidget() {
    const preferences = new PrefsWidget();
    preferences.connect('notify::root', () => {
        const window = preferences.get_root();
        const headerbar = new Headerbar();
        window.set_titlebar(headerbar);
    });
    return preferences;
}
