const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Gettext = imports.gettext;
const Convenience = Me.imports.convenience;

const Domain = Gettext.domain(Me.metadata['gettext-domain']);
const _ = Domain.gettext;

const {SHOW_ALL_SLIDER, SHOW_VALUE_LABEL} = Me.imports.convenience;


function init() {
  ExtensionUtils.initTranslations(Me.metadata['gettext-domain']);
}

function buildPrefsWidget() {
  let widget = new MyPrefsWidget();
  return widget;
}

const MyPrefsWidget = GObject.registerClass(
  class MyPrefsWidget extends Gtk.Box {

    _init(params) {
      super._init(params);
      this._settings = Convenience.getSettings();
      this.set_orientation(Gtk.Orientation.VERTICAL);

      let showAllSliderBox = new Gtk.Box({marginStart:7, marginEnd:7, marginBottom:5, marginTop:5});

      const showAllSliderLabel = new Gtk.Label({label:_("Enable \"All\" Slider"),
      xalign: 0, marginEnd:7});

      const showAllSliderSwitch = new Gtk.Switch({active: this._settings.get_boolean(SHOW_ALL_SLIDER)});
      showAllSliderSwitch.connect('notify::active', button => {
          this._settings.set_boolean(SHOW_ALL_SLIDER, button.active);
      });

      showAllSliderBox.append(showAllSliderLabel);
      showAllSliderBox.append(showAllSliderSwitch);



      let showValueLabelBox = new Gtk.Box({marginStart:7, marginEnd:7, marginBottom:5, marginTop:5});

      const showValueLabelLabel = new Gtk.Label({label:_("Show Value Label"),
      xalign: 0, marginEnd:7});

      const showValueLabelSwitch = new Gtk.Switch({active: this._settings.get_boolean(SHOW_VALUE_LABEL)});
      showValueLabelSwitch.connect('notify::active', button => {
          this._settings.set_boolean(SHOW_VALUE_LABEL, button.active);
      });

      showValueLabelBox.append(showValueLabelLabel);
      showValueLabelBox.append(showValueLabelSwitch);

      this.append(showValueLabelBox);
      this.append(showAllSliderBox);

    }

  });
