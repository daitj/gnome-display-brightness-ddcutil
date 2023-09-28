import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

/**
 * Check if the given keyval is forbidden.
 *
 * @param {number} keyval The keyval number.
 * @returns {boolean} `true` if the keyval is forbidden.
 */
export function isKeyvalForbidden(keyval) {
    const forbiddenKeyvals = [
        Gdk.KEY_Home,
        Gdk.KEY_Left,
        Gdk.KEY_Up,
        Gdk.KEY_Right,
        Gdk.KEY_Down,
        Gdk.KEY_Page_Up,
        Gdk.KEY_Page_Down,
        Gdk.KEY_End,
        Gdk.KEY_Tab,
        Gdk.KEY_KP_Enter,
        Gdk.KEY_Return,
        Gdk.KEY_BackSpace,
        Gdk.KEY_Mode_switch,
    ];
    return forbiddenKeyvals.includes(keyval);
}

/**
 * Check if the given key combo is a valid binding
 *
 * @param {{mask: number, keycode: number, keyval:number}} combo An object
 * representing the key combo.
 * @returns {boolean} `true` if the key combo is a valid binding.
 */
export function isBindingValid({mask, keycode, keyval}) {
    if ((mask === 0 || mask === Gdk.SHIFT_MASK) && keycode !== 0) {
        if (
            (keyval >= Gdk.KEY_a && keyval <= Gdk.KEY_z) ||
          (keyval >= Gdk.KEY_A && keyval <= Gdk.KEY_Z) ||
          (keyval >= Gdk.KEY_0 && keyval <= Gdk.KEY_9) ||
          (keyval >= Gdk.KEY_kana_fullstop && keyval <= Gdk.KEY_semivoicedsound) ||
          (keyval >= Gdk.KEY_Arabic_comma && keyval <= Gdk.KEY_Arabic_sukun) ||
          (keyval >= Gdk.KEY_Serbian_dje && keyval <= Gdk.KEY_Cyrillic_HARDSIGN) ||
          (keyval >= Gdk.KEY_Greek_ALPHAaccent && keyval <= Gdk.KEY_Greek_omega) ||
          (keyval >= Gdk.KEY_hebrew_doublelowline && keyval <= Gdk.KEY_hebrew_taf) ||
          (keyval >= Gdk.KEY_Thai_kokai && keyval <= Gdk.KEY_Thai_lekkao) ||
          (keyval >= Gdk.KEY_Hangul_Kiyeog && keyval <= Gdk.KEY_Hangul_J_YeorinHieuh) ||
          (keyval === Gdk.KEY_space && mask === 0) ||
          isKeyvalForbidden(keyval)
        )
            return false;
    }
    return true;
}

/**
* Check if the given key combo is a valid accelerator.
*
* @param {{mask: number, keyval:number}} combo An object representing the key
* combo.
* @returns {boolean} `true` if the key combo is a valid accelerator.
*/
export function isAccelValid({mask, keyval}) {
    return Gtk.accelerator_valid(keyval, mask) || (keyval === Gdk.KEY_Tab && mask !== 0);
}
