Display Brightness Slider for Gnome Shell

![screenshot](screenshot.jpg)

- [Setup ddcutil](#setup-ddcutil)
- [Installation](#installation)
  - [Automatically from GNOME extensions](#automatically-from-gnome-extensions)
  - [Manually from the source code](#manually-from-the-source-code)
- [Troubleshoot](#troubleshoot)
  - [Screen hangs/locks on first startup](#screen-hangslocks-on-first-startup)
  - [Docking or Daisy chain](#docking-or-daisy-chain)
  - [Cannot detect display](#cannot-detect-display)
- [Credits](#credits)
    - [Thanks to the following people for contributing via pull requests:](#thanks-to-the-following-people-for-contributing-via-pull-requests)
    - [Thanks to the following extensions for the inspiration](#thanks-to-the-following-extensions-for-the-inspiration)
## Setup ddcutil

1. install `ddcutil`

2. Manually load kernel module `i2c-dev`

```sh

sudo modprobe i2c-dev

```

3. Verify that your monitor supports brightness control

```sh

ddcutil capabilities | grep "Feature: 10"

```

4. udev rule for giving group i2c RW permission on the `/dev/i2c` devices

ddcutil 2.0+
```sh

sudo cp /usr/share/ddcutil/data/60-ddcutil-i2c.rules /etc/udev/rules.d

```
**Note: Fedora 40+ users, you need to uncomment this line**
```
# KERNEL=="i2c-[0-9]*", GROUP="i2c", MODE="0660"
```

Prior ddcutil 1.4.0
```sh

sudo cp /usr/share/ddcutil/data/45-ddcutil-i2c.rules /etc/udev/rules.d

```

Read more: [https://www.ddcutil.com/i2c_permissions/](https://www.ddcutil.com/i2c_permissions/)


5. Create i2c group and add yourself

```sh

sudo groupadd --system i2c

sudo usermod $USER -aG i2c

```

6. load `i2c-dev` automatically

```sh

sudo touch /etc/modules-load.d/i2c.conf

sudo sh -c 'echo "i2c-dev" >> /etc/modules-load.d/i2c.conf'

```

7. Reboot for changes to take effect

```sh

sudo reboot

```

This tool uses ddcutil as backend, so first make sure that your user can use use following shell commands without root or sudo.

`ddcutil getvcp 10` to check the brightness of a monitor and

`ddcutil setvcp 10 100` to set the brightness to 100

It automatically supports multiple displays detected by

`ddcutil detect`


## Installation

### Automatically from GNOME extensions
You can find this extension [here](https://extensions.gnome.org/extension/2645/brightness-control-using-ddcutil/)

### Manually from the source code
Clone this repo and in the repo's root directory run these shell commands

```sh
make build
make install
```

## Troubleshoot

### Screen hangs/locks on first startup
In my hardware for some reason when `ddcutil detect` is ran for the first time after a cold boot and then, when it checks for i2c busno=1, whole system locks for couple of seconds.
As a workaround I changed this extension to read cached info from a file, when it exists.

```sh
ddcutil --brief detect > $XDG_CACHE_HOME/ddcutil_detect
```
### Docking or Daisy chain

If you using a dock and are having issues:

Read more about issues with dock [ddcutil.com FAQ](https://www.ddcutil.com/faq/#docking)

Also some docks use daisy chaining behind the scenes.

If you are daisy chaining the monitors i.e. instead of connecting each monitor to the GPU/Laptop directly, you are connecting monitor to another monitor. Then try to tweak the extension settings `Advanced settings` > `ddcutil Sleep Multipler ms`. Daisy chain doesn't allow running parallel instance of ddcutil.


### Cannot detect display

If you have issues detecting the display and stuck in "Initializing", check if disabling display state check from extension settings `Advanced settings` > `Disable Display State Check` works.

If you find your monitor listed on [rockowitz/ddcutil repo wiki](https://github.com/rockowitz/ddcutil/wiki/Notes-on-Specific-Monitors), check what is recommended for your monitor.

## Credits

This extension wouldn't exist without [rockowitz/ddcutil](https://github.com/rockowitz/ddcutil)

This extension is developed and maintained by [@daitj](https://github.com/daitj)

#### Thanks to the following people for contributing via pull requests:
- @oscfdezdz for adding new settings UI, keyboard shortcuts and ability to set icon location
- @maniacx for porting the extension to GNOME 45
#### Thanks to the following extensions for the inspiration
- [Night Theme Switcher](https://extensions.gnome.org/extension/2236/night-theme-switcher/) for keyboard shortcut UI.
