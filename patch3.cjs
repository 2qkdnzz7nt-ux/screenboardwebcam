const fs = require('fs');
const path = 'src/hooks/useScreenRecorder.ts';
let content = fs.readFileSync(path, 'utf8');

// Add webcamStream to return value
content = content.replace(
    '\t\twebcamEnabled,\n\t\tsetWebcamEnabled,\n\t};',
    '\t\twebcamEnabled,\n\t\tsetWebcamEnabled,\n\t\twebcamStream: getState(webcamStreamForUI)[0],\n\t};'
);

fs.writeFileSync(path, content);
console.log('Added webcamStream to return');