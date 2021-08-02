build:
	make schemas
	gnome-extensions pack -f --podir=po --extra-source=convenience.js --extra-source=ui.js ./display-brightness-ddcutil@themightydeity.github.com/ --out-dir=./dist

install:
	gnome-extensions install --force ./dist/display-brightness-ddcutil@themightydeity.github.com.shell-extension.zip

translation: 
	xgettext --from-code=UTF-8 --output=display-brightness-ddcutil\@themightydeity.github.com/po/display-brightness-ddcutil.pot ./display-brightness-ddcutil\@themightydeity.github.com/*.js

schemas:
	glib-compile-schemas ./display-brightness-ddcutil@themightydeity.github.com/schemas

clean:
	rm -f ./dist/display-brightness-ddcutil@themightydeity.github.com.shell-extension.zip
	rm -f ./display-brightness-ddcutil@themightydeity.github.com/schemas/gschemas.compiled
