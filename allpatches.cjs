const fs = require('fs');
let content = fs.readFileSync('src/hooks/useScreenRecorder.ts', 'utf8');

// 1. Add webcamStreamForUI after webcamStream ref
const old1 = 'const webcamStream = useRef<MediaStream | null>(null);\n\tconst mixingContext';
const new1 = 'const webcamStream = useRef<MediaStream | null>(null);\n\tconst webcamStreamForUI = useState<MediaStream | null>(null);\n\tconst mixingContext';
content = content.replace(old1, new1);

// 2. Add state update on stream acquisition
const old2 = 'webcamStream.current = stream;\n\t\t\t\twebcamReady.current = true;';
const new2 = 'webcamStream.current = stream;\n\t\t\t\tgetState(webcamStreamForUI)[1](stream);\n\t\t\t\twebcamReady.current = true;';
content = content.replace(old2, new2);

// 3. Add state update in track.onended
const old3 = 'webcamStream.current = null;\n\t\t\t\t\tif (!restarting.current)';
const new3 = 'webcamStream.current = null;\n\t\t\t\t\tgetState(webcamStreamForUI)[1](null);\n\t\t\t\t\tif (!restarting.current)';
content = content.replace(old3, new3);

// 4. Add state update in cleanup
const old4 = 'webcamStream.current = null;\n\t\t};\n\t};\n\n\tconst finalizeRecording';
const new4 = 'webcamStream.current = null;\n\t\t\t\tgetState(webcamStreamForUI)[1](null);\n\t\t};\n\t};\n\n\tconst finalizeRecording';
content = content.replace(old4, new4);

// 5. Add webcamStream to return
const old5 = '\t\twebcamEnabled,\n\t\tsetWebcamEnabled,\n\t};';
const new5 = '\t\twebcamEnabled,\n\t\tsetWebcamEnabled,\n\t\twebcamStream: getState(webcamStreamForUI)[0],\n\t};';
content = content.replace(old5, new5);

fs.writeFileSync('src/hooks/useScreenRecorder.ts', content);
console.log('All patches applied');