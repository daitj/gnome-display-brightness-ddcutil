/* -*- mode: js; js-basic-offset: 4; indent-tabs-mode: nil -*- */
/*
  Copyright (c) 2011-2012, Giovanni Campagna <scampa.giovanni@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the GNOME nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
  ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
  DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
  SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

const Gettext = imports.gettext;
const { Gdk, Gio, GLib, Gtk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;

function brightnessLog(str) {
  let settings = ExtensionUtils.getSettings();
  if (settings.get_boolean('verbose-debugging')) {
    log("display-brightness-ddcutil extension:\n" + str);
  }
}

//timer
/**
 * Taken from: https://github.com/optimisme/gjs-examples/blob/master/assets/timers.js
 */
function setTimeout(func, millis /* , ... args */) {

  let args = [];
  if (arguments.length > 2) {
    args = args.slice.call(arguments, 2);
  }

  let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, millis, () => {
    func.apply(null, args);
    return GLib.SOURCE_REMOVE;; // Stop repeating
  });

  return id;
};

function clearTimeout(id) {
  GLib.source_remove(id);
};


function setInterval(func, millis /* , ... args */) {

  let args = [];
  if (arguments.length > 2) {
      args = args.slice.call(arguments, 2);
  }
  brightnessLog(`setInterval called ${millis}`);

  let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, millis, () => {
    func.apply(null, args);
    return GLib.SOURCE_CONTINUE;; // Repeat
  });

  brightnessLog(`setInterval set ${millis}`);

  return id;
};

function clearInterval(id) {
  GLib.source_remove(id);
};

function spawnWithCallback(argv, callback) {
  let proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);

  proc.communicate_utf8_async(null, null, (proc, res) => {
    try{
      let [, stdout, stderr] = proc.communicate_utf8_finish(res);
      if (proc.get_successful()) {
        callback(stdout);
      }else{
        /* 
        errors from ddcutil (like monitor not found) were actually in stdout
        only the process return code was 1
        */
        if(stderr){
          callback(stderr);
        }else if(stdout){
          callback(stdout);
        }
      }
    }catch(e){
      brightnessLog(e.message);
    }
  });
}

/**
 * Check if the given keyval is forbidden.
 *
 * @param {number} keyval The keyval number.
 * @returns {boolean} `true` if the keyval is forbidden.
 */
 function isKeyvalForbidden(keyval) {
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
 function isBindingValid({ mask, keycode, keyval }) {
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
function isAccelValid({ mask, keyval }) {
  return Gtk.accelerator_valid(keyval, mask) || (keyval === Gdk.KEY_Tab && mask !== 0);
}
