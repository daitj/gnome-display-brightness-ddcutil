all: build install

build: schemas
	gnome-extensions pack \
		--force \
		--extra-source=ui \
		--extra-source=convenience.js \
		--extra-source=headerbar.js \
		--extra-source=indicator.js \
		./display-brightness-ddcutil@themightydeity.github.com/ \
		--out-dir=./dist

install:
	gnome-extensions install \
		--force \
		./dist/display-brightness-ddcutil@themightydeity.github.com.shell-extension.zip

pot:
	mkdir -p ./display-brightness-ddcutil@themightydeity.github.com/po
	xgettext \
		--from-code=UTF-8 \
		--output=display-brightness-ddcutil\@themightydeity.github.com/po/display-brightness-ddcutil.pot \
		./display-brightness-ddcutil\@themightydeity.github.com/ui/* ./display-brightness-ddcutil\@themightydeity.github.com/extension.js

update-po:
	for po_file in ./display-brightness-ddcutil@themightydeity.github.com/po/*.po; do \
		msgmerge --update $$po_file display-brightness-ddcutil@themightydeity.github.com/po/display-brightness-ddcutil.pot; \
	done

schemas:
	glib-compile-schemas ./display-brightness-ddcutil@themightydeity.github.com/schemas

clean:
	rm -f "./dist/display-brightness-ddcutil@themightydeity.github.com.shell-extension.zip"
	rm -f "./display-brightness-ddcutil@themightydeity.github.com/schemas/gschemas.compiled"
