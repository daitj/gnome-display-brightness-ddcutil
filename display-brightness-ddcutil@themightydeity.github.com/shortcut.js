import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Convenience from './conveniencePref.js';

const ShortcutWidget = GObject.registerClass({
    GTypeName: 'ShortcutWidget',
    Template: GLib.Uri.resolve_relative(import.meta.url, './ui/shortcut.ui', GLib.UriFlags.NONE),
    InternalChildren: [
        'set_button',
        'shortcut_label',
        'shortcut_entry',
        'clear_button',
        'edit_button',
        'dialog',
        'shortcut_info_label',
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
        this._shortcut_info_label.set_text(_('Enter the new shortcut'));
        this._dialog.transient_for = this.get_root();
        this._dialog.present();
    }

    onClearButtonClicked(_button) {
        this.keybinding = '';
    }

    onEditButtonToggled(_button) {
        if (this._shortcut_label.visible) {
            this._shortcut_entry.get_buffer().set_text(this._shortcut_label.get_accelerator(), -1);
            this.keybinding = this._shortcut_entry.get_buffer().get_text();
        } else {
            this._shortcut_label.set_accelerator(this._shortcut_entry.get_buffer().get_text());
            this.keybinding = this._shortcut_label.get_accelerator();
        }

        this._shortcut_label.visible = !this._shortcut_label.visible;
        this._shortcut_entry.visible = !this._shortcut_entry.visible;
        this._clear_button.visible = !this._clear_button.visible;
        if (this._edit_button.iconName === 'document-edit-symbolic')
            this._edit_button.iconName = 'document-save-symbolic';
        else
            this._edit_button.iconName = 'document-edit-symbolic';
    }

    onKeyPressed(_widget, keyval, keycode, state) {
        let mask = state & Gtk.accelerator_get_default_mod_mask();
        mask &= ~Gdk.ModifierType.LOCK_MASK;

        if (keyval === Gdk.KEY_Escape) {
            this._dialog.close();
            return Gdk.EVENT_STOP;
        }

        if (
            !Convenience.isBindingValid({mask, keycode, keyval}) ||
            !Convenience.isAccelValid({mask, keyval})
        ) {
            this._shortcut_info_label.set_text(_('Reserved or invalid binding'));
            return Gdk.EVENT_STOP;
        }

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
