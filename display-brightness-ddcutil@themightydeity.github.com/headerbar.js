const {Gio, GObject, Gtk} = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Headerbar = GObject.registerClass({
    GTypeName: 'Headerbar',
    Template: Me.dir.get_child('./ui/headerbar.ui').get_uri(),
    InternalChildren: [
        'reload_button'
    ],
}, class PrefsWidget extends Gtk.HeaderBar {

    _init(params = {}) {
        super._init(params);
        this.settings = ExtensionUtils.getSettings();
    }

    // Triggers onReload function
    onReloadButtonClicked(_button) {
        this.settings.set_boolean('reload', true);
        this.settings.set_boolean('reload', false);
    }

  }
);
