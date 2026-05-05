import { fixWebmDuration } from "@fix-webm-duration/fix";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useScopedT } from "@/contexts/I18nContext";
import { requestCameraAccess } from "@/lib/requestCameraAccess";

const TARGET_FRAME_RATE = 60;
const MIN_FRAME_RATE = 30;
const TARGET_WIDTH = 3840;
const TARGET_HEIGHT = 2160;
const FOUR_K_PIXELS = TARGET_WIDTH * TARGET_HEIGHT;
const QHD_WIDTH = 2560;
const QHD_HEIGHT = 1440;
const QHD_PIXELS = QHD_WIDTH * QHD_HEIGHT;

const BITRATE_4K = 45_000_000;
const BITRATE_QHD = 28_000_000;
const BITRATE_BASE = 18_000_000;
const HIGH_FRAME_RATE_THRESHOLD = 60;
const HIGH_FRAME_RATE_BOOST = 1.7;

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

const CODEC_ALIGNMENT = 2;

const RECORDER_TIMESLICE_MS = 1000;
const BITS_PER_MEGABIT = 1_000_000;
const CHROME_MEDIA_SOURCE = "desktop";
const RECORDING_FILE_PREFIX = "recording-";
const VIDEO_FILE_EXTENSION = ".webm";
const _WEBCAM_FILE_SUFFIX = "-webcam";

const AUDIO_BITRATE_VOICE = 128_000;
const AUDIO_BITRATE_SYSTEM = 192_000;

const MIC_GAIN_BOOST = 1.4;
const WEBCAM_TARGET_WIDTH = 1280;
const WEBCAM_TARGET_HEIGHT = 720;
const WEBCAM_TARGET_FRAME_RATE = 30;

type UseScreenRecorderReturn = {
	recording: boolean;
	paused: boolean;
	elapsedSeconds: number;
	toggleRecording: () => void;
	togglePaused: () => void;
	restartRecording: () => void;
	cancelRecording: () => void;
	microphoneEnabled: boolean;
	setMicrophoneEnabled: (enabled: boolean) => void;
	microphoneDeviceId: string | undefined;
	setMicrophoneDeviceId: (deviceId: string | undefined) => void;
	webcamDeviceId: string | undefined;
	setWebcamDeviceId: (deviceId: string | undefined) => void;
	systemAudioEnabled: boolean;
	setSystemAudioEnabled: (enabled: boolean) => void;
	webcamEnabled: boolean;
	setWebcamEnabled: (enabled: boolean) => Promise<boolean>;
	webcamStream: MediaStream | null;
	setWebcamOverlayPos: (pos: { x: number; y: number } | null) => void;
};

type RecorderHandle = {
	recorder: MediaRecorder;
	recordedBlobPromise: Promise<Blob>;
};

function createRecorderHandle(stream: MediaStream, options: MediaRecorderOptions): RecorderHandle {
	const recorder = new MediaRecorder(stream, options);
	const chunks: Blob[] = [];
	const mimeType = options.mimeType || "video/webm";
	const recordedBlobPromise = new Promise<Blob>((resolve, reject) => {
		recorder.ondataavailable = (event: BlobEvent) => {
			if (event.data && event.data.size > 0) {
				chunks.push(event.data);
			}
		};
		recorder.onerror = () => {
			reject(new Error("Recording failed"));
		};
		recorder.onstop = () => {
			resolve(new Blob(chunks, { type: mimeType }));
		};
	});

	recorder.start(RECORDER_TIMESLICE_MS);
	return { recorder, recordedBlobPromise };
}

export function useScreenRecorder(): UseScreenRecorderReturn {
	const t = useScopedT("editor");
	const [recording, setRecording] = useState(false);
	const [paused, setPaused] = useState(false);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
	const [microphoneDeviceId, setMicrophoneDeviceId] = useState<string | undefined>(undefined);
	const [webcamDeviceId, setWebcamDeviceId] = useState<string | undefined>(undefined);
	const [systemAudioEnabled, setSystemAudioEnabled] = useState(false);
	const [webcamEnabled, setWebcamEnabledState] = useState(false);
	const screenRecorder = useRef<RecorderHandle | null>(null);
	const stream = useRef<MediaStream | null>(null);
	const screenStream = useRef<MediaStream | null>(null);
	const microphoneStream = useRef<MediaStream | null>(null);
	const webcamStream = useRef<MediaStream | null>(null);
	const [webcamStreamForUI, setWebcamStreamForUI] = useState<MediaStream | null>(null);
	const mixingContext = useRef<AudioContext | null>(null);
	const recordingId = useRef<number>(0);
	const accumulatedDurationMs = useRef(0);
	const segmentStartedAt = useRef<number | null>(null);
	const finalizingRecordingId = useRef<number | null>(null);
	const allowAutoFinalize = useRef(false);
	const discardRecordingId = useRef<number | null>(null);
	const restarting = useRef(false);
	const countdownRunId = useRef(0);
	const [countdownActive, setCountdownActive] = useState(false);
	const webcamReady = useRef(false);
	const webcamAcquireId = useRef(0);
	const compositingCanvas = useRef<HTMLCanvasElement | null>(null);
	const compositingScreenVideo = useRef<HTMLVideoElement | null>(null);
	const compositingWebcamVideo = useRef<HTMLVideoElement | null>(null);
	const compositingAnimId = useRef<number>(0);
	const webcamOverlayPos = useRef<{ x: number; y: number } | null>(null);

	const getRecordingDurationMs = useCallback(() => {
		const segmentDuration =
			segmentStartedAt.current === null ? 0 : Date.now() - segmentStartedAt.current;
		return accumulatedDurationMs.current + segmentDuration;
	}, []);

	const selectMimeType = () => {
		// H.264 first: hardware-accelerated on all modern devices, gives sharp
		// real-time output. AV1/VP9 are great for distribution but too
		// CPU-intensive for live 60 fps capture — they produce blurry frames
		// when the software encoder can't keep up.
		const preferred = [
			"video/webm;codecs=h264",
			"video/webm;codecs=vp8",
			"video/webm;codecs=vp9",
			"video/webm;codecs=av1",
			"video/webm",
		];

		return preferred.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
	};

	const computeBitrate = (width: number, height: number) => {
		const pixels = width * height;
		const highFrameRateBoost =
			TARGET_FRAME_RATE >= HIGH_FRAME_RATE_THRESHOLD ? HIGH_FRAME_RATE_BOOST : 1;

		if (pixels >= FOUR_K_PIXELS) {
			return Math.round(BITRATE_4K * highFrameRateBoost);
		}

		if (pixels >= QHD_PIXELS) {
			return Math.round(BITRATE_QHD * highFrameRateBoost);
		}

		return Math.round(BITRATE_BASE * highFrameRateBoost);
	};

	const stopCompositing = useCallback(() => {
		if (compositingAnimId.current) {
			cancelAnimationFrame(compositingAnimId.current);
			compositingAnimId.current = 0;
		}
		if (compositingScreenVideo.current) {
			compositingScreenVideo.current.srcObject = null;
			compositingScreenVideo.current = null;
		}
		if (compositingWebcamVideo.current) {
			compositingWebcamVideo.current.srcObject = null;
			compositingWebcamVideo.current = null;
		}
		if (compositingCanvas.current) {
			compositingCanvas.current
				.getContext("2d")
				?.clearRect(0, 0, compositingCanvas.current.width, compositingCanvas.current.height);
			compositingCanvas.current = null;
		}
	}, []);

	const teardownMedia = useCallback(() => {
		stopCompositing();
		if (stream.current) {
			stream.current.getTracks().forEach((track) => track.stop());
			stream.current = null;
		}
		if (screenStream.current) {
			screenStream.current.getTracks().forEach((track) => track.stop());
			screenStream.current = null;
		}
		if (microphoneStream.current) {
			microphoneStream.current.getTracks().forEach((track) => track.stop());
			microphoneStream.current = null;
		}
		if (mixingContext.current) {
			mixingContext.current.close().catch(() => {
				// Ignore close errors during recorder teardown.
			});
			mixingContext.current = null;
		}
	}, [stopCompositing]);

	const setWebcamEnabled = useCallback(
		async (enabled: boolean) => {
			if (!enabled) {
				setWebcamEnabledState(false);
				return true;
			}

			const accessResult = await requestCameraAccess();
			if (!accessResult.success) {
				toast.error(t("recording.failedCameraAccess"));
				return false;
			}

			if (!accessResult.granted) {
				toast.error(t("recording.cameraBlocked"));
				return false;
			}

			setWebcamEnabledState(true);
			return true;
		},
		[t],
	);

	useEffect(() => {
		if (!webcamEnabled) return;

		let cancelled = false;
		let acquiredStream: MediaStream | null = null;
		const thisAcquireId = ++webcamAcquireId.current;
		webcamReady.current = false;

		const acquire = async () => {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: false,
					video: webcamDeviceId
						? {
								deviceId: { exact: webcamDeviceId },
								width: { ideal: WEBCAM_TARGET_WIDTH },
								height: { ideal: WEBCAM_TARGET_HEIGHT },
								frameRate: { ideal: WEBCAM_TARGET_FRAME_RATE, max: WEBCAM_TARGET_FRAME_RATE },
							}
						: {
								width: { ideal: WEBCAM_TARGET_WIDTH },
								height: { ideal: WEBCAM_TARGET_HEIGHT },
								frameRate: { ideal: WEBCAM_TARGET_FRAME_RATE, max: WEBCAM_TARGET_FRAME_RATE },
							},
				});

				if (cancelled || thisAcquireId !== webcamAcquireId.current) {
					stream.getTracks().forEach((track) => {
						track.onended = null;
						track.stop();
					});
					return;
				}

				acquiredStream = stream;
				stream.getVideoTracks().forEach((track) => {
					track.onended = () => {
						webcamStream.current = null;
						if (!restarting.current) {
							setWebcamEnabledState(false);
							toast.error(t("recording.cameraDisconnected"));
						}
					};
				});
				webcamStream.current = stream;
				setWebcamStreamForUI(stream);
			} catch (cameraError) {
				if (!cancelled) {
					console.warn("Failed to get webcam access:", cameraError);
					setWebcamEnabledState(false);
					const isDeviceError =
						cameraError instanceof DOMException &&
						[
							"NotFoundError",
							"DevicesNotFoundError",
							"OverconstrainedError",
							"NotReadableError",
						].includes(cameraError.name);
					toast.error(t(isDeviceError ? "recording.cameraNotFound" : "recording.cameraBlocked"));
					webcamReady.current = true;
				}
			}
		};

		void acquire();

		return () => {
			cancelled = true;
			webcamReady.current = false;
			if (acquiredStream) {
				acquiredStream.getTracks().forEach((track) => {
					track.onended = null;
					track.stop();
				});
				webcamStream.current = null;
			}
			setWebcamStreamForUI(null);
		};
	}, [webcamEnabled, webcamDeviceId, t]);

	const finalizeRecording = useCallback(
		(activeScreenRecorder: RecorderHandle, duration: number, activeRecordingId: number) => {
			if (finalizingRecordingId.current === activeRecordingId) {
				return;
			}
			finalizingRecordingId.current = activeRecordingId;

			if (screenRecorder.current === activeScreenRecorder) {
				screenRecorder.current = null;
			}

			teardownMedia();
			setRecording(false);
			setPaused(false);
			setElapsedSeconds(0);
			accumulatedDurationMs.current = 0;
			segmentStartedAt.current = null;
			window.electronAPI?.setRecordingState(false);

			void (async () => {
				try {
					const screenBlob = await activeScreenRecorder.recordedBlobPromise;
					if (discardRecordingId.current === activeRecordingId) {
						window.electronAPI?.discardCursorTelemetry(activeRecordingId);
						return;
					}
					if (screenBlob.size === 0) {
						return;
					}

					const fixedScreenBlob = await fixWebmDuration(screenBlob, duration);

					const screenFileName = `${RECORDING_FILE_PREFIX}${activeRecordingId}${VIDEO_FILE_EXTENSION}`;
					const result = await window.electronAPI.storeRecordedSession({
						screen: {
							videoData: await fixedScreenBlob.arrayBuffer(),
							fileName: screenFileName,
						},
						createdAt: activeRecordingId,
					});

					if (!result.success) {
						console.error("Failed to store recording session:", result.message);
						return;
					}

					if (result.session) {
						await window.electronAPI.setCurrentRecordingSession(result.session);
					} else if (result.path) {
						await window.electronAPI.setCurrentVideoPath(result.path);
					}

					await window.electronAPI.switchToEditor();
				} catch (error) {
					console.error("Error saving recording:", error);
				} finally {
					if (finalizingRecordingId.current === activeRecordingId) {
						finalizingRecordingId.current = null;
					}
					if (discardRecordingId.current === activeRecordingId) {
						discardRecordingId.current = null;
					}
				}
			})();
		},
		[teardownMedia],
	);

	const stopRecording = useRef(() => {
		const activeScreenRecorder = screenRecorder.current;
		if (!activeScreenRecorder) {
			return;
		}

		const duration = getRecordingDurationMs();
		const activeRecordingId = recordingId.current;

		finalizeRecording(activeScreenRecorder, duration, activeRecordingId);

		if (
			activeScreenRecorder.recorder.state === "recording" ||
			activeScreenRecorder.recorder.state === "paused"
		) {
			try {
				activeScreenRecorder.recorder.stop();
			} catch {
				// Recorder may already be stopping.
			}
		}
	});

	useEffect(() => {
		let cleanup: (() => void) | undefined;

		if (window.electronAPI?.onStopRecordingFromTray) {
			cleanup = window.electronAPI.onStopRecordingFromTray(() => {
				stopRecording.current();
			});
		}

		return () => {
			const activeRunId = countdownRunId.current;
			if (cleanup) cleanup();
			countdownRunId.current += 1;
			void safeHideCountdownOverlay(activeRunId);
			allowAutoFinalize.current = false;
			restarting.current = false;
			discardRecordingId.current = null;

			if (
				screenRecorder.current?.recorder.state === "recording" ||
				screenRecorder.current?.recorder.state === "paused"
			) {
				try {
					screenRecorder.current.recorder.stop();
				} catch {
					// Ignore recorder teardown errors during cleanup.
				}
			}
			screenRecorder.current = null;
			teardownMedia();
		};
	}, [teardownMedia, safeHideCountdownOverlay]);

	const safeShowCountdownOverlay = async (value: number, runId: number) => {
		try {
			await window.electronAPI.showCountdownOverlay(value, runId);
			return true;
		} catch (error) {
			console.warn("Failed to show countdown overlay:", error);
			return false;
		}
	};

	const cancelCountdown = () => {
		const activeRunId = countdownRunId.current;
		countdownRunId.current += 1;
		setCountdownActive(false);
		void safeHideCountdownOverlay(activeRunId);
	};

	const safeSetCountdownOverlayValue = async (value: number, runId: number) => {
		try {
			await window.electronAPI.setCountdownOverlayValue(value, runId);
		} catch (error) {
			console.warn("Failed to update countdown overlay value:", error);
		}
	};

	const safeHideCountdownOverlay = useCallback(async (runId: number) => {
		try {
			await window.electronAPI.hideCountdownOverlay(runId);
		} catch (error) {
			console.warn("Failed to hide countdown overlay:", error);
		}
	}, []);

	const isCountdownRunActive = (runId?: number) =>
		runId === undefined || countdownRunId.current === runId;

	const startRecordCountdown = async () => {
		if (countdownActive || recording) {
			return;
		}

		const runId = countdownRunId.current + 1;
		countdownRunId.current = runId;
		setCountdownActive(true);

		let selectedSource: ProcessedDesktopSource | null = null;
		try {
			selectedSource = await window.electronAPI.getSelectedSource();
		} catch (error) {
			console.warn("Failed to read selected source before countdown:", error);
		}

		if (!isCountdownRunActive(runId)) {
			return;
		}

		if (!selectedSource) {
			if (countdownRunId.current === runId) {
				setCountdownActive(false);
			}
			alert(t("recording.selectSource"));
			return;
		}

		let overlayHiddenBeforeStart = false;
		try {
			const values = [3, 2, 1];
			const overlayShown = await safeShowCountdownOverlay(values[0], runId);

			if (countdownRunId.current !== runId) {
				return;
			}

			for (const value of values) {
				if (countdownRunId.current !== runId) {
					return;
				}

				if (overlayShown && value !== values[0]) {
					await safeSetCountdownOverlayValue(value, runId);

					if (countdownRunId.current !== runId) {
						return;
					}
				}

				await new Promise((resolve) => window.setTimeout(resolve, 1000));
			}

			if (countdownRunId.current !== runId) {
				return;
			}

			setCountdownActive(false);
			await safeHideCountdownOverlay(runId);
			overlayHiddenBeforeStart = true;

			if (countdownRunId.current !== runId) {
				return;
			}

			await startRecording(runId);
		} finally {
			if (!overlayHiddenBeforeStart && countdownRunId.current === runId) {
				setCountdownActive(false);
				await safeHideCountdownOverlay(runId);
			}
		}
	};

	const startRecording = async (countdownRunToken?: number) => {
		try {
			const selectedSource = await window.electronAPI.getSelectedSource();
			if (!selectedSource) {
				alert(t("recording.selectSource"));
				return;
			}

			if (!isCountdownRunActive(countdownRunToken)) {
				teardownMedia();
				return;
			}

			let screenMediaStream: MediaStream;

			const videoConstraints = {
				mandatory: {
					chromeMediaSource: CHROME_MEDIA_SOURCE,
					chromeMediaSourceId: selectedSource.id,
					maxWidth: TARGET_WIDTH,
					maxHeight: TARGET_HEIGHT,
					maxFrameRate: TARGET_FRAME_RATE,
					minFrameRate: MIN_FRAME_RATE,
				},
			};

			if (systemAudioEnabled) {
				try {
					screenMediaStream = await navigator.mediaDevices.getUserMedia({
						audio: {
							mandatory: {
								chromeMediaSource: CHROME_MEDIA_SOURCE,
								chromeMediaSourceId: selectedSource.id,
							},
						},
						video: videoConstraints,
					} as unknown as MediaStreamConstraints);
				} catch (audioErr) {
					console.warn("System audio capture failed, falling back to video-only:", audioErr);
					toast.error(t("recording.systemAudioUnavailable"));
					screenMediaStream = await navigator.mediaDevices.getUserMedia({
						audio: false,
						video: videoConstraints,
					} as unknown as MediaStreamConstraints);
				}
			} else {
				screenMediaStream = await navigator.mediaDevices.getUserMedia({
					audio: false,
					video: videoConstraints,
				} as unknown as MediaStreamConstraints);
			}
			screenStream.current = screenMediaStream;

			if (!isCountdownRunActive(countdownRunToken)) {
				teardownMedia();
				return;
			}

			if (microphoneEnabled) {
				try {
					microphoneStream.current = await navigator.mediaDevices.getUserMedia({
						audio: microphoneDeviceId
							? {
									deviceId: { exact: microphoneDeviceId },
									echoCancellation: true,
									noiseSuppression: true,
									autoGainControl: true,
								}
							: {
									echoCancellation: true,
									noiseSuppression: true,
									autoGainControl: true,
								},
						video: false,
					});
				} catch (audioError) {
					console.warn("Failed to get microphone access:", audioError);
					toast.error(t("recording.microphoneDenied"));
					setMicrophoneEnabled(false);
				}
			}

			if (!isCountdownRunActive(countdownRunToken)) {
				teardownMedia();
				return;
			}

			if (webcamEnabled) {
				if (!webcamReady.current) {
					await new Promise<void>((resolve) => {
						const interval = setInterval(() => {
							if (webcamReady.current) {
								clearInterval(interval);
								resolve();
							}
						}, 50);
						setTimeout(() => {
							clearInterval(interval);
							resolve();
						}, 5000);
					});
				}
				if (!webcamStream.current) {
					webcamAcquireId.current++;
					setWebcamEnabledState(false);
				}
			}

			if (!isCountdownRunActive(countdownRunToken)) {
				teardownMedia();
				return;
			}

			stream.current = new MediaStream();
			const videoTrack = screenMediaStream.getVideoTracks()[0];
			if (!videoTrack) {
				throw new Error("Video track is not available.");
			}

			// When the webcam is enabled, composite the screen + circular webcam
			// overlay onto a hidden canvas and record that composited stream.
			// This guarantees the webcam appears in the output even if the
			// transparent HUD overlay window is not captured by the OS-level
			// screen capture API (a known issue on Windows with layered windows).
			const shouldComposite = webcamEnabled && webcamStream.current != null;

			if (shouldComposite) {
				// Create a hidden canvas at the screen resolution
				const canvas = document.createElement("canvas");
				canvas.width = TARGET_WIDTH;
				canvas.height = TARGET_HEIGHT;
				compositingCanvas.current = canvas;

				// Play the screen stream into a hidden <video>
				const screenVid = document.createElement("video");
				screenVid.srcObject = new MediaStream([videoTrack]);
				screenVid.muted = true;
				screenVid.playsInline = true;
				void screenVid.play();
				compositingScreenVideo.current = screenVid;

				// Play the webcam stream into a hidden <video>
				const webcamVid = document.createElement("video");
				webcamVid.srcObject = webcamStream.current!;
				webcamVid.muted = true;
				webcamVid.playsInline = true;
				void webcamVid.play();
				compositingWebcamVideo.current = webcamVid;

				// Start the compositing render loop
				const drawComposite = () => {
					const c = compositingCanvas.current;
					const sv = compositingScreenVideo.current;
					const wv = compositingWebcamVideo.current;
					if (!c) return;

					const ctx = c.getContext("2d");
					if (!ctx) return;

					const cw = c.width;
					const ch = c.height;

					// Draw the screen frame
					if (sv && sv.readyState >= 2) {
						ctx.drawImage(sv, 0, 0, cw, ch);
					}

					// Draw the circular webcam overlay
					if (wv && wv.readyState >= 2) {
						const webcamSize = Math.round(Math.min(cw, ch) * 0.15);
						const padding = Math.round(Math.min(cw, ch) * 0.02);
						const pos = webcamOverlayPos.current;
						const wx = pos ? Math.round(pos.x * cw) : cw - webcamSize - padding;
						const wy = pos ? Math.round(pos.y * ch) : ch - webcamSize - padding;

						ctx.save();
						ctx.beginPath();
						ctx.arc(wx + webcamSize / 2, wy + webcamSize / 2, webcamSize / 2, 0, Math.PI * 2);
						ctx.clip();

						const vw = wv.videoWidth || 1;
						const vh = wv.videoHeight || 1;
						const scale = Math.max(webcamSize / vw, webcamSize / vh);
						const dw = vw * scale;
						const dh = vh * scale;
						ctx.drawImage(wv, wx + (webcamSize - dw) / 2, wy + (webcamSize - dh) / 2, dw, dh);
						ctx.restore();
					}

					compositingAnimId.current = requestAnimationFrame(drawComposite);
				};
				compositingAnimId.current = requestAnimationFrame(drawComposite);

				// Record the composited canvas stream instead of the raw screen track
				const compositedStream = canvas.captureStream(TARGET_FRAME_RATE);
				const compositedTrack = compositedStream.getVideoTracks()[0];
				stream.current.addTrack(compositedTrack);
			} else {
				stream.current.addTrack(videoTrack);
			}

			const systemAudioTrack = screenMediaStream.getAudioTracks()[0];
			const micAudioTrack = microphoneStream.current?.getAudioTracks()[0];

			if (systemAudioTrack && micAudioTrack) {
				const ctx = new AudioContext();
				mixingContext.current = ctx;
				const systemSource = ctx.createMediaStreamSource(new MediaStream([systemAudioTrack]));
				const micSource = ctx.createMediaStreamSource(new MediaStream([micAudioTrack]));
				const micGain = ctx.createGain();
				micGain.gain.value = MIC_GAIN_BOOST;
				const destination = ctx.createMediaStreamDestination();
				systemSource.connect(destination);
				micSource.connect(micGain).connect(destination);
				stream.current.addTrack(destination.stream.getAudioTracks()[0]);
			} else if (systemAudioTrack) {
				stream.current.addTrack(systemAudioTrack);
			} else if (micAudioTrack) {
				stream.current.addTrack(micAudioTrack);
			}

			try {
				await videoTrack.applyConstraints({
					frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
					width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
					height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
				});
			} catch (constraintError) {
				console.warn(
					"Unable to lock 4K/60fps constraints, using best available track settings.",
					constraintError,
				);
			}

			if (!isCountdownRunActive(countdownRunToken)) {
				teardownMedia();
				return;
			}

			let {
				width = DEFAULT_WIDTH,
				height = DEFAULT_HEIGHT,
				frameRate = TARGET_FRAME_RATE,
			} = videoTrack.getSettings();

			width = Math.floor(width / CODEC_ALIGNMENT) * CODEC_ALIGNMENT;
			height = Math.floor(height / CODEC_ALIGNMENT) * CODEC_ALIGNMENT;

			const videoBitsPerSecond = computeBitrate(width, height);
			const mimeType = selectMimeType();

			console.log(
				`Recording at ${width}x${height} @ ${frameRate ?? TARGET_FRAME_RATE}fps using ${mimeType} / ${Math.round(
					videoBitsPerSecond / BITS_PER_MEGABIT,
				)} Mbps`,
			);

			const hasAudio = stream.current.getAudioTracks().length > 0;
			if (!isCountdownRunActive(countdownRunToken)) {
				teardownMedia();
				return;
			}

			screenRecorder.current = createRecorderHandle(stream.current, {
				mimeType,
				videoBitsPerSecond,
				...(hasAudio
					? { audioBitsPerSecond: systemAudioTrack ? AUDIO_BITRATE_SYSTEM : AUDIO_BITRATE_VOICE }
					: {}),
			});
			screenRecorder.current.recorder.addEventListener(
				"error",
				() => {
					setRecording(false);
				},
				{ once: true },
			);

			recordingId.current = Date.now();
			accumulatedDurationMs.current = 0;
			segmentStartedAt.current = Date.now();
			allowAutoFinalize.current = true;
			setRecording(true);
			setPaused(false);
			setElapsedSeconds(0);
			window.electronAPI?.setRecordingState(true, recordingId.current);

			const activeScreenRecorder = screenRecorder.current;
			const activeRecordingId = recordingId.current;
			if (activeScreenRecorder) {
				activeScreenRecorder.recorder.addEventListener(
					"stop",
					() => {
						if (!allowAutoFinalize.current) {
							return;
						}
						finalizeRecording(
							activeScreenRecorder,
							Math.max(0, getRecordingDurationMs()),
							activeRecordingId,
						);
					},
					{ once: true },
				);
			}
		} catch (error) {
			console.error("Failed to start recording:", error);
			const errorMsg = error instanceof Error ? error.message : "Failed to start recording";
			if (errorMsg.includes("Permission denied") || errorMsg.includes("NotAllowedError")) {
				toast.error(t("recording.permissionDenied"));
			} else {
				toast.error(errorMsg);
			}
			setRecording(false);
			setPaused(false);
			setElapsedSeconds(0);
			accumulatedDurationMs.current = 0;
			segmentStartedAt.current = null;
			screenRecorder.current = null;
			teardownMedia();
		}
	};

	const togglePaused = () => {
		const activeScreenRecorder = screenRecorder.current?.recorder;
		if (!activeScreenRecorder || activeScreenRecorder.state === "inactive") {
			return;
		}

		if (activeScreenRecorder.state === "paused") {
			try {
				activeScreenRecorder.resume();
				segmentStartedAt.current = Date.now();
				setPaused(false);
			} catch (error) {
				console.error("Failed to resume recording:", error);
			}
			return;
		}

		if (activeScreenRecorder.state !== "recording") {
			return;
		}

		try {
			accumulatedDurationMs.current = getRecordingDurationMs();
			segmentStartedAt.current = null;
			setElapsedSeconds(Math.floor(accumulatedDurationMs.current / 1000));
			activeScreenRecorder.pause();
			setPaused(true);
		} catch (error) {
			console.error("Failed to pause recording:", error);
		}
	};

	const toggleRecording = () => {
		if (recording) {
			stopRecording.current();
			return;
		}

		if (countdownActive) {
			cancelCountdown();
			return;
		}

		void startRecordCountdown();
	};

	const restartRecording = async () => {
		if (restarting.current) return;

		const activeScreenRecorder = screenRecorder.current;
		if (!activeScreenRecorder || activeScreenRecorder.recorder.state === "inactive") return;

		const activeRecordingId = recordingId.current;

		restarting.current = true;
		discardRecordingId.current = activeRecordingId;

		const stopPromises = [
			new Promise<void>((resolve) => {
				activeScreenRecorder.recorder.addEventListener("stop", () => resolve(), { once: true });
			}),
		];

		stopRecording.current();
		await Promise.all(stopPromises);

		try {
			await startRecording();
		} finally {
			restarting.current = false;
		}
	};

	useEffect(() => {
		if (!recording) {
			setElapsedSeconds(0);
			return;
		}

		setElapsedSeconds(Math.floor(getRecordingDurationMs() / 1000));
		if (paused) {
			return;
		}

		const interval = window.setInterval(() => {
			setElapsedSeconds(Math.floor(getRecordingDurationMs() / 1000));
		}, 250);

		return () => window.clearInterval(interval);
	}, [getRecordingDurationMs, paused, recording]);

	const setWebcamOverlayPos = useCallback((pos: { x: number; y: number } | null) => {
		webcamOverlayPos.current = pos;
	}, []);

	const cancelRecording = () => {
		const activeScreenRecorder = screenRecorder.current;
		if (
			activeScreenRecorder?.recorder.state === "recording" ||
			activeScreenRecorder?.recorder.state === "paused"
		) {
			const activeRecordingId = recordingId.current;
			discardRecordingId.current = activeRecordingId;
			allowAutoFinalize.current = false;

			stopRecording.current();
			return;
		}

		if (countdownActive) {
			cancelCountdown();
			return;
		}
	};

	return {
		recording,
		paused,
		elapsedSeconds,
		toggleRecording,
		togglePaused,
		restartRecording,
		cancelRecording,
		microphoneEnabled,
		setMicrophoneEnabled,
		microphoneDeviceId,
		setMicrophoneDeviceId,
		webcamDeviceId,
		setWebcamDeviceId,
		systemAudioEnabled,
		setSystemAudioEnabled,
		webcamEnabled,
		setWebcamEnabled,
		webcamStream: webcamStreamForUI,
		setWebcamOverlayPos,
	};
}
