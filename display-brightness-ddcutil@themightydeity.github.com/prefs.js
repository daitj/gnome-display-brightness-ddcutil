const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;


const SHOW_ALL_SLIDER = 'show-all-slider';

function init() { }

function buildPrefsWidget() {
  let widget = new MyPrefsWidget();
  widget.show_all();
  return widget;
}

const MyPrefsWidget = GObject.registerClass(
  class MyPrefsWidget extends Gtk.Box {

    _init(params) {
      super._init(params);
      this._settings = Convenience.getSettings();
      this.set_orientation(Gtk.Orientation.VERTICAL);
      this.connect('destroy', Gtk.main_quit);

      let showAllSliderBox = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL,
        margin: 7});

        const showAllSliderLabel = new Gtk.Label({label:"Enable \"All\" Slider",
      xalign: 0});

      const showAllSliderSwitch = new Gtk.Switch({active: this._settings.get_boolean(SHOW_ALL_SLIDER)});
      showAllSliderSwitch.connect('notify::active', button => {
          this._settings.set_boolean(SHOW_ALL_SLIDER, button.active);
      });

      showAllSliderBox.pack_start(showAllSliderLabel, true, true, 0);
      showAllSliderBox.add(showAllSliderSwitch);

      this.add(showAllSliderBox);
    }

  });
