<p align="center">
  <img src="public/openscreen.png" alt="ScreenBoardWebcam Logo" width="64" />
</p>

# <p align="center">ScreenBoardWebcam</p>

<p align="center"><strong>A free, open-source screen recorder with independent webcam dual-stream recording.</strong></p>

ScreenBoardWebcam is a modified version of [OpenScreen](https://github.com/siddharthvaddem/openscreen) by Siddharth Vaddem, enhanced with an independent webcam dual-stream recording architecture. It allows you to record your screen and webcam as two separate video streams, giving you full flexibility in post-editing to position, resize, or hide the webcam overlay.

## What's Different from OpenScreen

- **Independent webcam recording**: Screen and webcam are recorded as separate streams (`.webm` + `-webcam.webm`), not composited into one video
- **Webcam preview only in HUD**: The webcam circle in the HUD is for preview only — it's excluded from the screen recording via Windows `setContentProtection`
- **Flexible editor layout**: The video editor receives both streams independently, allowing free positioning of the webcam picture-in-picture
- **Portable exe build**: Single-file portable executable, no installer needed

## Core Features

- Record specific windows or your whole screen
- Independent webcam recording with dual-stream architecture
- Add automatic or manual zooms (adjustable depth levels) and customize their duration and position
- Record microphone and system audio
- Crop video recordings to hide parts
- Choose between wallpapers, solid colors, gradients or a custom background
- Motion blur for smoother pan and zoom effects
- Add annotations (text, arrows, images)
- Trim sections of the clip
- Customize the speed of different segments
- Export in different aspect ratios and resolutions

## Webcam Architecture

### Preview (HUD Layer)
- HUD is a fullscreen transparent window (alwaysOnTop, transparent, frameless) covering the entire screen workspace
- Camera stream obtained via `getUserMedia`, rendered as a circular preview, draggable to any position
- Preview is for viewing only — not composited into the screen recording
- On Windows, HUD window uses `setContentProtection(true)` to ensure DXGI screen capture excludes the HUD

### Recording (Independent Dual Streams)
- **Screen stream**: Records `desktopCapturer` video track (+ optional system audio/mic mix), saves as `recording-xxx.webm`
- **Webcam stream**: When webcam is enabled, independently creates `webcamRecorder`, saves as `recording-xxx-webcam.webm`
- Both streams are completely independent; stored together via `storeRecordedSession` with a `.session.json` manifest

### Editor (Layout Module)
- Editor reads `screenVideoPath` and `webcamVideoPath` from `RecordingSession`
- Layout module gets dedicated webcam source for flexible positioning of picture-in-picture

## Installation

Download the latest release for your platform from the [GitHub Releases](https://github.com/2qkdnzz7nt-ux/screenboardwebcam/releases) page.

### Windows

Download `screenboardwebcam-x.x.x.exe` and run it directly — no installation needed (portable).

### macOS

If you encounter issues with macOS Gatekeeper blocking the app, run the following command in your terminal:

```bash
xattr -rd com.apple.quarantine /Applications/ScreenBoardWebcam.app
```

After that, grant the necessary permissions for "screen recording" and "accessibility" in **System Preferences > Security & Privacy**.

### Linux

Download the `.AppImage` file from the releases page. Make it executable and run:

```bash
chmod +x ScreenBoardWebcam-Linux-*.AppImage
./ScreenBoardWebcam-Linux-*.AppImage
```

If the app fails to launch due to a "sandbox" error, run with `--no-sandbox`.

### System Audio Limitations

- **macOS**: Requires macOS 13+. macOS 12 and below does not support system audio (mic still works).
- **Windows**: Works out of the box.
- **Linux**: Needs PipeWire (default on Ubuntu 22.04+, Fedora 34+).

## Built With

- Electron
- React
- TypeScript
- Vite
- PixiJS
- dnd-timeline

## Acknowledgements

This project is based on [OpenScreen](https://github.com/siddharthvaddem/openscreen) by Siddharth Vaddem. Thank you for the great open-source foundation!

## License

This project is licensed under the [MIT License](./LICENSE).

Original work Copyright (c) 2025 Siddharth Vaddem  
Modifications Copyright (c) 2026 ScreenBoardWebcam contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
