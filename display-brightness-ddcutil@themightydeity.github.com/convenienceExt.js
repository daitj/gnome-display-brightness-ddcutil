import Gio from 'gi://Gio';

/**
 * 
 * @param {*} settings 
 * @param {*} str 
 */
export function brightnessLog(settings, str) {
    if (settings.get_boolean('verbose-debugging'))
        console.log(`display-brightness-ddcutil extension: ${str}`);
}

export function isNullOrWhitespace(str) {
    return str === undefined || str === null || str.match(/^\s*$/) !== null;
}

export function spawnWithCallback(settings, argv, callback) {
    try {
        const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);

        const [_, stdout, stderr] = proc.communicate_utf8(null, null);
        if (proc.get_successful()) {
            callback(stdout);
        } else {
            /*
                errors from ddcutil (like monitor not found) were actually in stdout
                only the process return code was 1
            */
            if (stderr)
                callback(stderr);
            else if (stdout)
                callback(stdout);
        }
    } catch (e) {
        brightnessLog(settings, e.message);
    }
}


/**
 * Filters a VCP Feature Codes output to make sure only valid lines are returned.
 *
 * @param {string} val The `getvcp` feature code output
 * @returns {string} An array containing valid VPC lines, e.g. 'VPC D6 SNC 0x1'
 */
export function getVCPInfoAsArray(val) {
    const matched = val.trim().match(/^VCP.*$/gm)
    if(matched !== null){
        return matched.join('\n').split(' ')
    }else{
        return []
    }
}
