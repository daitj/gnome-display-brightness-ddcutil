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
const { GLib, Gio } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;

function brightnessLog(str) {
  log("display-brightness-ddcutil extension:\n" + str);
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

/* extra for this brightness extension added by github.com/themightydeity */

function spawnWithCallback(argv, callback) {
  let proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);

  proc.communicate_utf8_async(null, null, (proc, res) => {
    let [ok, stdout, stderr] = proc.communicate_utf8_finish(res);

    if (proc.get_successful()) {
      callback(stdout);
    }
  });
}
