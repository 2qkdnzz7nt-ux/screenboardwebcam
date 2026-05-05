const fs = require('fs');
const path = 'src/hooks/useScreenRecorder.ts';
let content = fs.readFileSync(path, 'utf8');

// Update line in track.onended
content = content.replace(
    'webcamStream.current = null;\n\t\t\t\t\tif (!restarting.current)',
    'webcamStream.current = null;\n\t\t\t\t\tgetState(webcamStreamForUI)[1](null);\n\t\t\t\t\tif (!restarting.current)'
);

// Update line after webcamStream.current = stream (when stream is acquired)
content = content.replace(
    'webcamStream.current = stream;\n\t\t\t\twebcamReady.current = true;',
    'webcamStream.current = stream;\n\t\t\t\tgetState(webcamStreamForUI)[1](stream);\n\t\t\t\twebcamReady.current = true;'
);

// Update line in cleanup (acquiredStream cleanup)
content = content.replace(
    'webcamStream.current = null;\n\t\t};\n\t};\n\n\tconst finalize',
    'webcamStream.current = null;\n\t\t\t\tgetState(webcamStreamForUI)[1](null);\n\t\t};\n\t};\n\n\tconst finalize'
);

fs.writeFileSync(path, content);
console.log('Updated webcamStream sync calls');