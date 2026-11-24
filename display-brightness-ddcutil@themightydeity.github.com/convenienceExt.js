import Gio from 'gi://Gio';

export function isNullOrWhitespace(str) {
    return str === undefined || str === null || str.match(/^\s*$/) !== null;
}

/**
 * 
 * @param {*} settings 
 * @param {*} str 
 */
export function brightnessLog(settings, ...args) {
    if (settings.get_boolean('verbose-debugging'))
        console.log(`display-brightness-ddcutil extension: `, ...args);
}

export async function spawnWithCallback(settings, argv, callback) {
    brightnessLog(settings, `Calling: ${argv.join(' ')}`);
    try {
        const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);

        await proc.communicate_utf8_async(null, null, async (proc, res)=>{
            const [, stdout, stderr] = proc.communicate_utf8_finish(res);
            if (proc.get_successful()) {
                await callback(stdout);
            } else {
                /*
                    errors from ddcutil (like monitor not found) were actually in stdout
                    only the process return code was 1
                */
                if (stderr)
                    await callback(stderr);
                else if (stdout)
                    await callback(stdout);
                else 
                    await callback("");
            }
        });
        
    } catch (e) {
        brightnessLog(settings, e);
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

export function getHDRStatus(settings, callback) {
    spawnWithCallback(settings, ['gdctl', 'show'], stdout => {
        const lines = stdout.split('\n');
        let currentMonitor = null;
        const hdrStatus = {};

        for (const line of lines) {
            const monitorMatch = line.match(/Monitor (DP-\d+)/);
            if (monitorMatch) {
                currentMonitor = monitorMatch[1];
                if (!hdrStatus[currentMonitor]) {
                    hdrStatus[currentMonitor] = { capable: false, active: false, mode: null };
                }
            }

            if (currentMonitor) {
                const modeMatch = line.match(/(\d+x\d+@[\d\.]+)/);
                if (modeMatch) {
                    hdrStatus[currentMonitor].mode = modeMatch[1];
                }

                if (line.includes('bt2100')) {
                    hdrStatus[currentMonitor].capable = true;
                    if (line.includes('(current)')) {
                        hdrStatus[currentMonitor].active = true;
                    }
                }
            }
        }
        callback(hdrStatus);
    });
}

export function sliderValuePercentFixed(sliderValue){
    return Math.round(sliderValue * 100);
}
