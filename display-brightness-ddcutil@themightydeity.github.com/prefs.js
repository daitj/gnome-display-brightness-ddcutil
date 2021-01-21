const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;

let settings = new Gio.Settings({path:'/org/gnome/shell/extensions/display-brightness-ddcutil/', schema_id:'org.gnome.shell.extensions.display-brightness-ddcutil'});

function init () {}

function buildPrefsWidget () {
  let widget = new MyPrefsWidget();
  widget.show_all();
  return widget;
}

const MyPrefsWidget = GObject.registerClass(
class MyPrefsWidget extends Gtk.Box {

  _init (params) {

    super._init(params);

    log(settings.get_int('my-int'));
    this.margin = 20;
    this.set_spacing(15);
    this.set_orientation(Gtk.Orientation.VERTICAL);

    this.connect('destroy', Gtk.main_quit);


    let enableButton = new Gtk.CheckButton({label: "Enable \"All\" Slider"});
    enableButton.set_active(settings.get_boolean('all-slider'));

    enableButton.connect("toggled", function (w) {
      settings.set_boolean('all-slider', enableButton.get_active());
    });

    let hBox = new Gtk.Box();
    hBox.set_orientation(Gtk.Orientation.HORIZONTAL);

    hBox.pack_start(enableButton, false, false, 0);
    hBox.pack_end(enableButton, false, false, 0);

    this.add(hBox);
  }

});
