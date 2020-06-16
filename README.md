# Display Brightness Slider for Gnome Shell

## Permission
Add your user to `i2c` group so that you can call `ddcutil` without `sudo`

## ddcutil
This tool uses ddcutil as backend, so first make sure that your user can use use following shell commands.

`ddcutil getvcp 10` to check the brightness of a monitor and

`ddcutil setvcp 10 100` to set the brightness to 100

It automatically supports multiple displays detected by

`ddcutil detect`

## Issues

### Screen hangs/locks on first startup
In my hardware for some reason when `ddcutil detect` is ran for the first time after a cold boot and then, when it checks for i2c busno=1, whole system locks for couple of seconds.
As a workaround I changed this extension to read cached info from a file, when it exists.
```
ddcutil --brief detect > $XDG_CACHE_HOME/ddcutil_detect
```