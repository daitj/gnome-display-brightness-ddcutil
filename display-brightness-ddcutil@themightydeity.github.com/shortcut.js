const { Gdk, GLib, GObject, Gtk } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Convenience = Me.imports.convenience;

const ShortcutWidget = GObject.registerClass({
    GTypeName: 'ShortcutWidget',
    Template: Me.dir.get_child('./ui/shortcut.ui').get_uri(),
    InternalChildren: [
        'set_button',
        'clear_button',
        'dialog'
    ],
    Properties: {
        keybinding: GObject.ParamSpec.string(
            'keybinding',
            'Keybinding',
            'Key sequence',
            GObject.ParamFlags.READWRITE,
            null
        ),
    },
}, class ShortcutWidget extends Gtk.Stack {

    onKeybindingChanged(button) {
        button.visible_child_name = button.keybinding ? 'edit' : 'set';
    }

    onSetButtonClicked(_button) {
        this._dialog.transient_for = this.get_root();
        this._dialog.present();
    }

    onClearButtonClicked(_button) {
        this.keybinding = '';
    }

    onKeyPressed(_widget, keyval, keycode, state) {
        let mask = state & Gtk.accelerator_get_default_mod_mask();
        mask &= ~Gdk.ModifierType.LOCK_MASK;

        if (mask === 0 && keyval === Gdk.KEY_Escape) {
            this._dialog.close();
            return Gdk.EVENT_STOP;
        }

        if (
            !Convenience.isBindingValid({ mask, keycode, keyval }) ||
            !Convenience.isAccelValid({ mask, keyval })
        )
            return Gdk.EVENT_STOP;

        this.keybinding = Gtk.accelerator_name_with_keycode(
            null,
            keyval,
            keycode,
            mask
        );

        this._dialog.close();

        return Gdk.EVENT_STOP;
    }

});
