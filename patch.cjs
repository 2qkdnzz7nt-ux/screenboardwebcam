const fs = require('fs');
const path = 'src/hooks/useScreenRecorder.ts';
let content = fs.readFileSync(path, 'utf8');

console.log('Looking for target line...');
const target = 'const webcamStream = useRef<MediaStream | null>(null);';
const idx = content.indexOf(target);
console.log('Found at index:', idx);

if (idx >= 0) {
    const newContent = content.slice(0, idx + target.length) + 
        '\r\n\tconst webcamStreamForUI = useState<MediaStream | null>(null);' + 
        content.slice(idx + target.length);
    fs.writeFileSync(path, newContent);
    console.log('Done - line added');
} else {
    console.log('Target line not found');
}