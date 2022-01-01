const {Gio, GObject, Gtk} = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const {SHOW_ALL_SLIDER, SHOW_VALUE_LABEL} = Me.imports.convenience;

const PrefsWidget = GObject.registerClass({
    GTypeName: 'PrefsWidget',
    Template: Me.dir.get_child('./ui/prefs.ui').get_uri(),
    InternalChildren: [
        'show_all_slider_switch',
        'show_value_label_switch',
        'increase_shortcut_entry',
        'decrease_shortcut_entry',
        'increase_shortcut_button',
        'decrease_shortcut_button'
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

      this._increase_shortcut_entry.text = this.settings.get_strv('increase-brightness-shortcut')[0];
      this._decrease_shortcut_entry.text = this.settings.get_strv('decrease-brightness-shortcut')[0];

      this._increase_shortcut_button.connect('clicked', widget => {
			    this.settings.set_strv('increase-brightness-shortcut', [this._increase_shortcut_entry.text]);
		  });

      this._decrease_shortcut_button.connect('clicked', widget => {
			    this.settings.set_strv('decrease-brightness-shortcut', [this._decrease_shortcut_entry.text]);
		  });
    }

  }
);

function init() {
  ExtensionUtils.initTranslations();
}

function buildPrefsWidget() {
  return new PrefsWidget();
}
