build:
	xgettext --from-code=UTF-8 --output=display-brightness-ddcutil\@themightydeity.github.com/po/display-brightness-ddcutil.pot ./display-brightness-ddcutil\@themightydeity.github.com/*.js
	gnome-extensions pack -f --podir=po --extra-source=convenience.js --extra-source=ui.js ./display-brightness-ddcutil@themightydeity.github.com/ --out-dir=./

install:
	gnome-extensions install --force ./display-brightness-ddcutil@themightydeity.github.com.shell-extension.zip

extension:
	./display-brightness-ddcutil@themightydeity.github.com/schemas/org.gnome.shell.extensions.display-brightness-ddcutil.gschema.xml
	glib-compile-schemas ./display-brightness-ddcutil@themightydeity.github.com/schemas

clean:
	rm -f ./display-brightness-ddcutil@themightydeity.github.com/schemas/gschemas.compiled
