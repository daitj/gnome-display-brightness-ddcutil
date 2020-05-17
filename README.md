# Display Brightness Slider for Gnome Shell

## Permission
Add your user to `i2c` group so that you can call `ddcutil` without `sudo`

## ddcutil
This tool uses ddcutil as backend, so first make sure that your user can use use following shell commands.

`ddcutil getvcp 10` to check the brightness of a monitor and

`ddcutil setvcp 10 100` to set the brightness to 100

It automatically supports multiple displays detected by

`ddcutil detect`

