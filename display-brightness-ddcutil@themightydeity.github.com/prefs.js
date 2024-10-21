import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import {gettext as _, ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as ShortcutWidget from './shortcut.js';

const PrefsWidget = GObject.registerClass({
    GTypeName: 'PrefsWidget',
    Template: GLib.Uri.resolve_relative(import.meta.url, './ui/prefs.ui', GLib.UriFlags.NONE),
    InternalChildren: [
        'show_all_slider_row',
        'show_internal_slider_row',
        'only_all_slider_row',
        'show_value_label_row',
        'show_display_name_row',
        'show_osd_row',
        'button_location_combo_row',
        'sub_menu_row',
        'hide_system_indicator_row',
        'position_system_indicator_row',
        'position_system_menu_row',
        'increase_shortcut_button',
        'decrease_shortcut_button',
        'step_keyboard_row',
        'ddcutil_binary_path_row',
        'sleep_multiplier_row',
        'queue_ms_row',
        'vcp_code_list_expander',
        'vcp_code_row_6b',
        'vcp_code_row_10',
        'ddcutil_additional_args_row',
        'allow_zero_brightness_row',
        'disable_display_state_check_row',
        'verbose_debugging_row',
    ],
}, class PrefsWidget extends Adw.PreferencesPage {
    _init(settings, params = {}) {
        super._init(params);
        this.settings = settings;
        this.settings.bind(
            'show-all-slider',
            this._show_all_slider_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'show-internal-slider',
            this._show_internal_slider_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'only-all-slider',
            this._only_all_slider_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'show-value-label',
            this._show_value_label_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'show-display-name',
            this._show_display_name_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'show-osd',
            this._show_osd_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'show-sliders-in-submenu',
            this._sub_menu_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this._button_location_combo_row.selected = this.settings.get_int('button-location');

        if (this._button_location_combo_row.selected === 0) {
            this._hide_system_indicator_row.sensitive = false;
            this._position_system_menu_row.sensitive = false;
        }

        this.settings.bind(
            'hide-system-indicator',
            this._hide_system_indicator_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this._position_system_indicator_row.value = this.settings.get_double('position-system-indicator');
        this._position_system_menu_row.value = this.settings.get_double('position-system-menu');
        this._step_keyboard_row.value = this.settings.get_double('step-change-keyboard');
        this._ddcutil_binary_path_row.set_text(this.settings.get_string('ddcutil-binary-path'));
        this._ddcutil_additional_args_row.set_text(this.settings.get_string('ddcutil-additional-args'));
        this._sleep_multiplier_row.value = this.settings.get_double('ddcutil-sleep-multiplier');
        this._queue_ms_row.value = this.settings.get_double('ddcutil-queue-ms');

        this.settings.bind(
            'vcp-10',
            this._vcp_code_row_10,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this.settings.bind(
            'vcp-6b',
            this._vcp_code_row_6b,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'allow-zero-brightness',
            this._allow_zero_brightness_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'disable-display-state-check',
            this._disable_display_state_check_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this.settings.bind(
            'verbose-debugging',
            this._verbose_debugging_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );


        this.settings.connect('changed::increase-brightness-shortcut', () => {
            this._increase_shortcut_button.keybinding = this.settings.get_strv('increase-brightness-shortcut')[0];
        });
        this._increase_shortcut_button.connect('notify::keybinding', () => {
            this.settings.set_strv('increase-brightness-shortcut', [this._increase_shortcut_button.keybinding]);
        });
        this._increase_shortcut_button.keybinding = this.settings.get_strv('increase-brightness-shortcut')[0];

        this.settings.connect('changed::decrease-brightness-shortcut', () => {
            this._decrease_shortcut_button.keybinding = this.settings.get_strv('decrease-brightness-shortcut')[0];
        });
        this._decrease_shortcut_button.connect('notify::keybinding', () => {
            this.settings.set_strv('decrease-brightness-shortcut', [this._decrease_shortcut_button.keybinding]);
        });
        this._decrease_shortcut_button.keybinding = this.settings.get_strv('decrease-brightness-shortcut')[0];

        this._position_system_indicator_row.sensitive = !this.settings.get_boolean('hide-system-indicator');
        this.settings.connect('changed::hide-system-indicator', () => {
            this._position_system_indicator_row.sensitive = !this.settings.get_boolean('hide-system-indicator');
        });

        this.settings.connect('changed::show-all-slider', () => {
            this.fixSubmenuModeVisibility()
        });
        this.settings.connect('changed::only-all-slider', () => {
            this.fixSubmenuModeVisibility()
        });

        this.settings.connect('changed::vcp-10', () => {
            this.fixVCPInfoSubtitle()
            this.disableLastVCP()
        });
        this.settings.connect('changed::vcp-6b', () => {
            this.fixVCPInfoSubtitle()
            this.disableLastVCP()
        });
        this.fixVCPInfoSubtitle()
        this.disableLastVCP()
        this.fixSubmenuModeVisibility()
    }
    getVCPList(){
        let vcpList = []
        if(this.settings.get_boolean('vcp-6b')){
            vcpList.push("6B")
        }
        if(this.settings.get_boolean('vcp-10')){
            vcpList.push("10")
        }
        return vcpList
    }
    disableLastVCP(){
        const vcpList = this.getVCPList()
        this._vcp_code_row_6b.sensitive = true
        this._vcp_code_row_10.sensitive = true
        if(vcpList.length == 1){
            if(vcpList[0] == "10"){
                this._vcp_code_row_10.sensitive = false
            }else{
                this._vcp_code_row_6b.sensitive = false
            }
        }
    }
    fixVCPInfoSubtitle(){
        const vcpList = this.getVCPList()
        this._vcp_code_list_expander.subtitle = `${vcpList.join(" ,")}`
    }
    fixSubmenuModeVisibility(){
        const allSliderActive = this.settings.get_boolean('show-all-slider')
        const onlyAllSliderActive  = this.settings.get_boolean('only-all-slider')
        const buttonLocation = this.settings.get_int('button-location')
        this._sub_menu_row.sensitive = true;
        this._sub_menu_row.set_subtitle("")
        const disableSubMenu = (subtitle) => {
            this._sub_menu_row.sensitive = false;
            this._sub_menu_row.set_subtitle(subtitle)
            this._sub_menu_row.set_active(false)
        }
        if (buttonLocation === 0) {
            disableSubMenu(_('Submenu mode cannot be enabled in TopBar mode '))
        }
        else{
            if(!allSliderActive){
                disableSubMenu(_('Need to enable ("All" slider)'))
            }else if(allSliderActive && onlyAllSliderActive){
                disableSubMenu(_('Need to disable (Only "All" slider)'))
            }
        }
    } 
    onButtonLocationChanged() {
        this.settings.set_int('button-location', this._button_location_combo_row.selected);
        if (this._button_location_combo_row.selected === 0) {
            this._hide_system_indicator_row.sensitive = false;
            this._position_system_menu_row.sensitive = false;
            this._position_system_indicator_row.sensitive = false;
        } else {
            this._hide_system_indicator_row.sensitive = true;
            this._position_system_menu_row.sensitive = true;
            this._position_system_indicator_row.sensitive = !this.settings.get_boolean('hide-system-indicator');
        }
        this.fixSubmenuModeVisibility()
    }

    onMenuPositionValueChanged() {
        this.settings.set_double('position-system-menu', this._position_system_menu_row.value);
    }

    onIndicatorPositionValueChanged() {
        this.settings.set_double('position-system-indicator', this._position_system_indicator_row.value);
    }

    onStepKeyboardValueChanged() {
        this.settings.set_double('step-change-keyboard', this._step_keyboard_row.value);
    }

    onDdcutilBinaryPathChanged() {
        this.settings.set_string('ddcutil-binary-path', this._ddcutil_binary_path_row.get_text());
    }

    onDdcutilAdditionalArgsChanged() {
        this.settings.set_string('ddcutil-additional-args', this._ddcutil_additional_args_row.get_text());
    }

    onSleepMultiplierValueChanged() {
        this.settings.set_double('ddcutil-sleep-multiplier', this._sleep_multiplier_row.value);
    }

    onQueueMsValueChanged() {
        this.settings.set_double('ddcutil-queue-ms', this._queue_ms_row.value);
    }
}
);

export default class DDCUtilBrightnessControlExtensionPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_size_request(500, 700);
        window.search_enabled = true;

        window.add(new PrefsWidget(settings));
    }
}
