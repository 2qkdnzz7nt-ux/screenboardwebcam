import { Check, ChevronDown, Languages } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BsPauseCircle, BsPlayCircle, BsRecordCircle } from "react-icons/bs";
import { FaRegStopCircle } from "react-icons/fa";
import { FaFolderOpen } from "react-icons/fa6";
import { FiMinus, FiX } from "react-icons/fi";
import {
	MdCancel,
	MdMic,
	MdMicOff,
	MdMonitor,
	MdRestartAlt,
	MdVideocam,
	MdVideocamOff,
	MdVideoFile,
	MdVolumeOff,
	MdVolumeUp,
} from "react-icons/md";
import { RxDragHandleDots2 } from "react-icons/rx";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { getAvailableLocales, getLocaleName } from "@/i18n/loader";
import { useAudioLevelMeter } from "../../hooks/useAudioLevelMeter";
import { useCameraDevices } from "../../hooks/useCameraDevices";
import { useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { requestCameraAccess } from "../../lib/requestCameraAccess";
import { formatTimePadded } from "../../utils/timeUtils";
import { AudioLevelMeter } from "../ui/audio-level-meter";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import styles from "./LaunchWindow.module.css";

const ICON_SIZE = 20;

const ICON_CONFIG = {
	drag: { icon: RxDragHandleDots2, size: ICON_SIZE },
	monitor: { icon: MdMonitor, size: ICON_SIZE },
	volumeOn: { icon: MdVolumeUp, size: ICON_SIZE },
	volumeOff: { icon: MdVolumeOff, size: ICON_SIZE },
	micOn: { icon: MdMic, size: ICON_SIZE },
	micOff: { icon: MdMicOff, size: ICON_SIZE },
	webcamOn: { icon: MdVideocam, size: ICON_SIZE },
	webcamOff: { icon: MdVideocamOff, size: ICON_SIZE },
	pause: { icon: BsPauseCircle, size: ICON_SIZE },
	resume: { icon: BsPlayCircle, size: ICON_SIZE },
	stop: { icon: FaRegStopCircle, size: ICON_SIZE },
	restart: { icon: MdRestartAlt, size: ICON_SIZE },
	cancel: { icon: MdCancel, size: ICON_SIZE },
	record: { icon: BsRecordCircle, size: ICON_SIZE },
	videoFile: { icon: MdVideoFile, size: ICON_SIZE },
	folder: { icon: FaFolderOpen, size: ICON_SIZE },
	minimize: { icon: FiMinus, size: ICON_SIZE },
	close: { icon: FiX, size: ICON_SIZE },
} as const;

type IconName = keyof typeof ICON_CONFIG;

function getIcon(name: IconName, className?: string) {
	const { icon: Icon, size } = ICON_CONFIG[name];
	return <Icon size={size} className={className} />;
}

const hudGroupClasses =
	"flex items-center gap-0.5 bg-white/5 rounded-full transition-colors duration-150 hover:bg-white/[0.08]";

const hudIconBtnClasses =
	"flex items-center justify-center p-2 rounded-full transition-all duration-150 cursor-pointer text-white hover:bg-white/10 hover:scale-[1.08] active:scale-95";

const hudAuxIconBtnClasses =
	"flex items-center justify-center p-1.5 rounded-full transition-colors duration-150 text-white/55 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed";

const windowBtnClasses =
	"flex items-center justify-center p-2 rounded-full transition-all duration-150 cursor-pointer opacity-50 hover:opacity-90 hover:bg-white/[0.08]";

const hudSidebarClasses = "ml-0.5 pl-1.5 border-l border-white/10 flex items-center gap-0.5";

export function LaunchWindow() {
	const t = useScopedT("launch");
	const availableLocales = getAvailableLocales();
	const {
		locale,
		setLocale,
		systemLocaleSuggestion,
		acceptSystemLocaleSuggestion,
		dismissSystemLocaleSuggestion,
		resolveSystemLocaleSuggestion,
	} = useI18n();
	const suggestedLanguageName = systemLocaleSuggestion ? getLocaleName(systemLocaleSuggestion) : "";

	const {
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
		systemAudioEnabled,
		setSystemAudioEnabled,
		webcamEnabled,
		setWebcamEnabled,
		webcamDeviceId,
		setWebcamDeviceId,
		webcamStream,
		setWebcamOverlayPos,
	} = useScreenRecorder();

	const showMicControls = microphoneEnabled && !recording;
	const showWebcamControls = webcamEnabled && !recording;

	const [isMicHovered, setIsMicHovered] = useState(false);
	const [isMicFocused, setIsMicFocused] = useState(false);
	const micExpanded = isMicHovered || isMicFocused;

	const [isWebcamHovered, setIsWebcamHovered] = useState(false);
	const [isWebcamFocused, setIsWebcamFocused] = useState(false);
	const webcamExpanded = isWebcamHovered || isWebcamFocused;

	// Webcam preview canvas and drag state
	const [webcamPos, setWebcamPos] = useState({ x: -1, y: -1 }); // left/top in px; -1 = auto-init to bottom-right
	const webcamDragRef = useRef({ dragging: false, offsetX: 0, offsetY: 0 });

	// ── Click-through control via mousemove ─────────────────────────
	// The HUD overlay window is click-through by default (setIgnoreMouseEvents).
	// With { forward: true }, mouse-move events are still forwarded to the
	// renderer. We use DOM hit-testing on each mousemove to detect whether
	// the cursor is over an interactive element (marked with data-hud-interactive)
	// and toggle setIgnoreMouseEvents accordingly. This avoids all DPI /
	// coordinate-mismatch issues that plague the cursor-polling approach on
	// Windows with non-100% display scaling.
	const hudBarRef = useRef<HTMLDivElement | null>(null);
	const webcamCanvasWrapperRef = useRef<HTMLCanvasElement | null>(null);
	const devicePanelRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const isOverInteractive = target.closest("[data-hud-interactive]") !== null;
			const isDragging = webcamDragRef.current.dragging;

			if (isOverInteractive || isDragging) {
				window.electronAPI?.setIgnoreMouseEvents(false);
			} else {
				window.electronAPI?.setIgnoreMouseEvents(true, { forward: true });
			}
		};

		window.addEventListener("mousemove", handleMouseMove);
		return () => window.removeEventListener("mousemove", handleMouseMove);
	}, []);
	const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
	const languageTriggerRef = useRef<HTMLButtonElement | null>(null);
	const languageMenuPanelRef = useRef<HTMLDivElement | null>(null);
	const [languageMenuStyle, setLanguageMenuStyle] = useState<{
		right: number;
		top: number;
		maxHeight: number;
	}>({
		right: 12,
		top: 12,
		maxHeight: 240,
	});

	const {
		devices: micDevices,
		selectedDeviceId: selectedMicId,
		setSelectedDeviceId: setSelectedMicId,
	} = useMicrophoneDevices(microphoneEnabled);
	const {
		devices: cameraDevices,
		selectedDeviceId: selectedCameraId,
		setSelectedDeviceId: setSelectedCameraId,
		isLoading: isCameraDevicesLoading,
		error: cameraDevicesError,
	} = useCameraDevices(webcamEnabled);

	const selectedMicLabel =
		micDevices.find((d) => d.deviceId === (microphoneDeviceId || selectedMicId))?.label ||
		t("audio.defaultMicrophone");
	const selectedCameraLabel = isCameraDevicesLoading
		? t("webcam.searching")
		: cameraDevicesError
			? t("webcam.unavailable")
			: cameraDevices.length === 0
				? t("webcam.noneFound")
				: cameraDevices.find((d) => d.deviceId === (webcamDeviceId || selectedCameraId))?.label ||
					t("webcam.defaultCamera");

	const { level } = useAudioLevelMeter({
		enabled: showMicControls,
		deviceId: microphoneDeviceId,
	});

	useEffect(() => {
		if (selectedMicId && selectedMicId !== "default") {
			setMicrophoneDeviceId(selectedMicId);
		}
	}, [selectedMicId, setMicrophoneDeviceId]);

	useEffect(() => {
		if (selectedCameraId) {
			setWebcamDeviceId(selectedCameraId);
		}
	}, [selectedCameraId, setWebcamDeviceId]);

	// Sync webcam preview position to recording compositing overlay (normalised 0-1)
	useEffect(() => {
		if (webcamPos.x >= 0 && webcamPos.y >= 0) {
			setWebcamOverlayPos({
				x: webcamPos.x / window.innerWidth,
				y: webcamPos.y / window.innerHeight,
			});
		} else {
			setWebcamOverlayPos(null);
		}
	}, [webcamPos, setWebcamOverlayPos]);

	// Update webcam preview when stream changes — draw to canvas for reliable circular clip
	const webcamCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const webcamVideoRef2 = useRef<HTMLVideoElement | null>(null);
	const webcamAnimRef = useRef<number>(0);

	const drawWebcamFrame = useCallback(() => {
		const video = webcamVideoRef2.current;
		const canvas = webcamCanvasRef.current;
		if (!video || !canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const size = canvas.width;
		const radius = size / 2;

		ctx.clearRect(0, 0, size, size);
		ctx.save();
		ctx.beginPath();
		ctx.arc(radius, radius, radius, 0, Math.PI * 2);
		ctx.clip();

		// Cover-fit the video into the square canvas
		const vw = video.videoWidth || 1;
		const vh = video.videoHeight || 1;
		const scale = Math.max(size / vw, size / vh);
		const dw = vw * scale;
		const dh = vh * scale;
		ctx.drawImage(video, (size - dw) / 2, (size - dh) / 2, dw, dh);
		ctx.restore();

		webcamAnimRef.current = requestAnimationFrame(drawWebcamFrame);
	}, []);

	useEffect(() => {
		if (!webcamStream) {
			cancelAnimationFrame(webcamAnimRef.current);
			const canvas = webcamCanvasRef.current;
			if (canvas) {
				canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
			}
			return;
		}

		const video = document.createElement("video");
		video.srcObject = webcamStream;
		video.muted = true;
		video.playsInline = true;
		video.autoplay = true;
		webcamVideoRef2.current = video;

		const onCanPlay = () => {
			cancelAnimationFrame(webcamAnimRef.current);
			webcamAnimRef.current = requestAnimationFrame(drawWebcamFrame);
		};
		video.addEventListener("canplay", onCanPlay);
		void video.play();

		return () => {
			video.removeEventListener("canplay", onCanPlay);
			cancelAnimationFrame(webcamAnimRef.current);
			video.srcObject = null;
			webcamVideoRef2.current = null;
		};
	}, [webcamStream, drawWebcamFrame]);

	useEffect(() => {
		if (!import.meta.env.DEV) {
			return;
		}

		void requestCameraAccess().catch((error) => {
			console.warn("Failed to trigger camera access request during development:", error);
		});
	}, []);

	useEffect(() => {
		if (!isLanguageMenuOpen) return;

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			const clickedTrigger = languageTriggerRef.current?.contains(target);
			const clickedMenu = languageMenuPanelRef.current?.contains(target);
			if (!clickedTrigger && !clickedMenu) {
				setIsLanguageMenuOpen(false);
			}
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsLanguageMenuOpen(false);
			}
		};

		window.addEventListener("pointerdown", handlePointerDown);
		window.addEventListener("keydown", handleEscape);

		return () => {
			window.removeEventListener("pointerdown", handlePointerDown);
			window.removeEventListener("keydown", handleEscape);
		};
	}, [isLanguageMenuOpen]);

	useEffect(() => {
		if (!isLanguageMenuOpen || !languageTriggerRef.current) return;

		const updatePosition = () => {
			if (!languageTriggerRef.current) return;
			const rect = languageTriggerRef.current.getBoundingClientRect();
			const gap = 8;
			const viewportPadding = 8;
			const availableHeight = Math.max(80, rect.top - viewportPadding - gap);
			const top = Math.max(viewportPadding, rect.top - gap - availableHeight);

			setLanguageMenuStyle({
				right: Math.max(viewportPadding, window.innerWidth - rect.right),
				top,
				maxHeight: availableHeight,
			});
		};

		updatePosition();
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);

		return () => {
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
		};
	}, [isLanguageMenuOpen]);

	useEffect(() => {
		if (!isLanguageMenuOpen || !languageMenuPanelRef.current) return;
		const id = requestAnimationFrame(() => {
			if (languageMenuPanelRef.current) {
				languageMenuPanelRef.current.scrollTop = 0;
			}
		});
		return () => cancelAnimationFrame(id);
	}, [isLanguageMenuOpen]);

	const [selectedSource, setSelectedSource] = useState("Screen");
	const [hasSelectedSource, setHasSelectedSource] = useState(false);

	useEffect(() => {
		const checkSelectedSource = async () => {
			if (window.electronAPI) {
				const source = await window.electronAPI.getSelectedSource();
				if (source) {
					setSelectedSource(source.name);
					setHasSelectedSource(true);
				} else {
					setSelectedSource("Screen");
					setHasSelectedSource(false);
				}
			}
		};

		checkSelectedSource();

		const interval = setInterval(checkSelectedSource, 500);
		return () => clearInterval(interval);
	}, []);

	const openSourceSelector = () => {
		if (window.electronAPI) {
			window.electronAPI.openSourceSelector();
		}
	};

	const openVideoFile = async () => {
		const result = await window.electronAPI.openVideoFilePicker();

		if (result.canceled) {
			return;
		}

		if (result.success && result.path) {
			await window.electronAPI.setCurrentVideoPath(result.path);
			await window.electronAPI.switchToEditor();
		}
	};

	const openProjectFile = async () => {
		const result = await window.electronAPI.loadProjectFile();
		if (result.canceled || !result.success) return;
		await window.electronAPI.switchToEditor();
	};

	const sendHudOverlayHide = () => {
		if (window.electronAPI && window.electronAPI.hudOverlayHide) {
			window.electronAPI.hudOverlayHide();
		}
	};
	const sendHudOverlayClose = () => {
		if (window.electronAPI && window.electronAPI.hudOverlayClose) {
			window.electronAPI.hudOverlayClose();
		}
	};

	const toggleMicrophone = () => {
		if (!recording) {
			setMicrophoneEnabled(!microphoneEnabled);
		}
	};

	return (
		// Root fills the HUD window only. Avoid w-screen/h-screen (100vw/100vh):
		// 100vw can exceed the inner layout width when scrollbars affect the
		// viewport (notably on Windows), causing a horizontal scrollbar once the
		// recording toolbar widened (issue #305).
		<div
			className={`h-full w-full min-w-0 max-w-full overflow-x-hidden overflow-y-hidden bg-transparent ${styles.electronDrag}`}
		>
			{/* Webcam preview - circular, borderless, draggable via canvas */}
			{webcamStream && (
				<canvas
					ref={(el) => {
						webcamCanvasRef.current = el;
						webcamCanvasWrapperRef.current = el;
					}}
					width={400}
					height={400}
					data-hud-interactive
					className={`fixed cursor-grab active:cursor-grabbing ${styles.electronNoDrag}`}
					style={{
						zIndex: 50,
						width: 200,
						height: 200,
						left: webcamPos.x < 0 ? undefined : webcamPos.x,
						top: webcamPos.y < 0 ? undefined : webcamPos.y,
						right: webcamPos.x < 0 ? 16 : undefined,
						bottom: webcamPos.x < 0 ? 80 : undefined,
					}}
					onPointerDown={(e) => {
						e.preventDefault();
						const rect = e.currentTarget.getBoundingClientRect();
						webcamDragRef.current = {
							dragging: true,
							offsetX: e.clientX - rect.left,
							offsetY: e.clientY - rect.top,
						};
						// While dragging, keep window interactive
						window.electronAPI?.setIgnoreMouseEvents(false);
						(e.target as HTMLElement).setPointerCapture(e.pointerId);
					}}
					onPointerMove={(e) => {
						if (!webcamDragRef.current.dragging) return;
						const newX = Math.max(0, Math.min(window.innerWidth - 200, e.clientX - webcamDragRef.current.offsetX));
						const newY = Math.max(0, Math.min(window.innerHeight - 200, e.clientY - webcamDragRef.current.offsetY));
						setWebcamPos({ x: newX, y: newY });
					}}
					onPointerUp={() => {
						webcamDragRef.current.dragging = false;
					}}
				/>
			)}

			{systemLocaleSuggestion && (
				<div
					className={`fixed top-8 left-1/2 z-30 w-[calc(100vw-1rem)] max-w-[520px] -translate-x-1/2 rounded-xl border border-white/15 bg-[rgba(20,20,28,0.95)] p-3 shadow-2xl backdrop-blur-xl text-white animate-in fade-in-0 zoom-in-95 duration-200 ${styles.electronNoDrag}`}
				>
					<div className="text-[13px] font-semibold text-white">
						{t("systemLanguagePrompt.title")}
					</div>
					<div className="mt-1 text-[11px] leading-relaxed text-white/75">
						{t("systemLanguagePrompt.description", {
							language: suggestedLanguageName,
						})}
					</div>
					<div className="mt-3 flex items-center justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={dismissSystemLocaleSuggestion}
							className="h-7 text-xs text-white/80 hover:bg-white/10 hover:text-white"
						>
							{t("systemLanguagePrompt.keepDefault")}
						</Button>
						<Button
							type="button"
							size="sm"
							onClick={acceptSystemLocaleSuggestion}
							className="h-7 text-xs bg-white text-[#10121b] hover:bg-white/90"
						>
							{t("systemLanguagePrompt.switch", {
								language: suggestedLanguageName,
							})}
						</Button>
					</div>
				</div>
			)}

			{/* Device selectors — fixed above HUD bar, viewport-relative, never clipped */}
			{(showMicControls || showWebcamControls) && (
				<div
					ref={devicePanelRef}
					data-hud-interactive
					className={`fixed bottom-[60px] left-1/2 -translate-x-1/2 flex items-center gap-2 animate-mic-panel-in ${styles.electronNoDrag}`}
				>
					{/* Mic selector */}
					{showMicControls && (
						<div
							className={`flex items-center gap-2 px-3 py-1.5 h-[36px] bg-gradient-to-br from-[rgba(28,28,36,0.97)] to-[rgba(18,18,26,0.96)] backdrop-blur-[24px] border border-white/10 rounded-xl shadow-2xl transition-all duration-300 overflow-hidden ${!micExpanded ? "opacity-60 grayscale-[0.5]" : "opacity-100"}`}
							onMouseEnter={() => setIsMicHovered(true)}
							onMouseLeave={() => setIsMicHovered(false)}
							onFocus={() => setIsMicFocused(true)}
							onBlur={() => setIsMicFocused(false)}
							style={{ width: micExpanded ? "240px" : "140px", transition: "width 300ms ease" }}
						>
							<div className="relative flex-1 min-w-0">
								{!micExpanded && (
									<div className="text-white/60 text-[10px] font-medium truncate">
										{selectedMicLabel}
									</div>
								)}
								<select
									value={microphoneDeviceId || selectedMicId}
									onChange={(e) => {
										setSelectedMicId(e.target.value);
										setMicrophoneDeviceId(e.target.value);
									}}
									className={`w-full appearance-none bg-white/5 text-white text-[11px] rounded-lg pl-2 pr-6 py-1 border border-white/10 outline-none hover:bg-white/10 transition-colors cursor-pointer ${!micExpanded ? "sr-only" : ""}`}
								>
									{micDevices.map((device) => (
										<option key={device.deviceId} value={device.deviceId} className="bg-[#1c1c24]">
											{device.label}
										</option>
									))}
								</select>
								{micExpanded && (
									<ChevronDown
										size={12}
										className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
									/>
								)}
							</div>
							<AudioLevelMeter
								level={level}
								className={`${micExpanded ? "w-16" : "w-8"} h-2 transition-all duration-300`}
							/>
						</div>
					)}

					{/* Webcam selector */}
					{showWebcamControls && (
						<div
							className={`flex items-center gap-2 px-3 py-1.5 h-[36px] bg-gradient-to-br from-[rgba(28,28,36,0.97)] to-[rgba(18,18,26,0.96)] backdrop-blur-[24px] border border-white/10 rounded-xl shadow-2xl transition-all duration-300 overflow-hidden ${!webcamExpanded ? "opacity-60 grayscale-[0.5]" : "opacity-100"}`}
							onMouseEnter={() => setIsWebcamHovered(true)}
							onMouseLeave={() => setIsWebcamHovered(false)}
							onFocus={() => setIsWebcamFocused(true)}
							onBlur={() => setIsWebcamFocused(false)}
							style={{ width: webcamExpanded ? "240px" : "140px", transition: "width 300ms ease" }}
						>
							<div className="relative flex-1 min-w-0">
								{!webcamExpanded && (
									<div className="text-white/60 text-[10px] font-medium truncate">
										{selectedCameraLabel}
									</div>
								)}
								{webcamExpanded &&
									(isCameraDevicesLoading ? (
										<span className="text-white/40 text-[10px] italic">
											{t("webcam.searching")}
										</span>
									) : cameraDevicesError ? (
										<span className="text-white/40 text-[10px] italic">
											{t("webcam.unavailable")}
										</span>
									) : cameraDevices.length === 0 ? (
										<span className="text-white/40 text-[10px] italic">
											{t("webcam.noneFound")}
										</span>
									) : (
										<>
											<select
												value={webcamDeviceId || selectedCameraId}
												onChange={(e) => {
													setSelectedCameraId(e.target.value);
													setWebcamDeviceId(e.target.value);
												}}
												className="w-full appearance-none bg-white/5 text-white text-[11px] rounded-lg pl-2 pr-6 py-1 border border-white/10 outline-none hover:bg-white/10 transition-colors cursor-pointer"
											>
												{cameraDevices.map((device) => (
													<option
														key={device.deviceId}
														value={device.deviceId}
														className="bg-[#1c1c24]"
													>
														{device.label}
													</option>
												))}
											</select>
											<ChevronDown
												size={12}
												className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
											/>
										</>
									))}
								{(!webcamExpanded || cameraDevices.length === 0) && (
									<select
										value={webcamDeviceId || selectedCameraId}
										onChange={(e) => {
											setSelectedCameraId(e.target.value);
											setWebcamDeviceId(e.target.value);
										}}
										className="sr-only"
									>
										{cameraDevices.map((device) => (
											<option key={device.deviceId} value={device.deviceId}>
												{device.label}
											</option>
										))}
									</select>
								)}
							</div>
						</div>
					)}
				</div>
			)}

			{/* HUD bar — fixed at bottom center, viewport-relative, never moves */}
			<div
				ref={hudBarRef}
				data-hud-interactive
				className={`fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-1.5 rounded-full shadow-hud-bar bg-gradient-to-br from-[rgba(28,28,36,0.97)] to-[rgba(18,18,26,0.96)] backdrop-blur-[16px] backdrop-saturate-[140%] border border-[rgba(80,80,120,0.25)]`}
			>
				{/* Drag handle */}
				<div className={`flex items-center px-1 ${styles.electronDrag}`}>
					{getIcon("drag", "text-white/30")}
				</div>

				{/* Source selector */}
				<button
					className={`${hudGroupClasses} p-2 ${styles.electronNoDrag}`}
					onClick={openSourceSelector}
					disabled={recording}
					title={selectedSource}
				>
					{getIcon("monitor", "text-white/80")}
					<span className="text-white/70 text-[11px] max-w-[72px] truncate">{selectedSource}</span>
				</button>

				{/* Audio controls group */}
				<div className={`${hudGroupClasses} ${styles.electronNoDrag}`}>
					<button
						className={`${hudIconBtnClasses} ${systemAudioEnabled ? "drop-shadow-[0_0_4px_rgba(74,222,128,0.4)]" : ""}`}
						onClick={() => !recording && setSystemAudioEnabled(!systemAudioEnabled)}
						disabled={recording}
						title={
							systemAudioEnabled ? t("audio.disableSystemAudio") : t("audio.enableSystemAudio")
						}
					>
						{systemAudioEnabled
							? getIcon("volumeOn", "text-green-400")
							: getIcon("volumeOff", "text-white/40")}
					</button>
					<button
						className={`${hudIconBtnClasses} ${microphoneEnabled ? "drop-shadow-[0_0_4px_rgba(74,222,128,0.4)]" : ""}`}
						onClick={toggleMicrophone}
						disabled={recording}
						title={microphoneEnabled ? t("audio.disableMicrophone") : t("audio.enableMicrophone")}
					>
						{microphoneEnabled
							? getIcon("micOn", "text-green-400")
							: getIcon("micOff", "text-white/40")}
					</button>
					<button
						className={`${hudIconBtnClasses} ${webcamEnabled ? "drop-shadow-[0_0_4px_rgba(74,222,128,0.4)]" : ""}`}
						onClick={async () => {
							await setWebcamEnabled(!webcamEnabled);
						}}
						disabled={recording}
						title={webcamEnabled ? t("webcam.disableWebcam") : t("webcam.enableWebcam")}
					>
						{webcamEnabled
							? getIcon("webcamOn", "text-green-400")
							: getIcon("webcamOff", "text-white/40")}
					</button>
				</div>

				{/* Record/Stop group */}
				<button
					className={`flex items-center justify-center rounded-full p-2 transition-[min-width,background-color] duration-150 ${recording ? "min-w-[78px]" : "min-w-[36px]"} ${styles.electronNoDrag} ${
						recording
							? paused
								? "bg-amber-500/10 hover:bg-amber-500/15"
								: "bg-red-500/12 hover:bg-red-500/16"
							: "bg-white/5 hover:bg-white/[0.08]"
					}`}
					onClick={toggleRecording}
					disabled={!hasSelectedSource && !recording}
					style={{ flex: "0 0 auto" }}
				>
					<div className={`flex items-center justify-center ${recording ? "gap-1.5" : ""}`}>
						{recording
							? getIcon("stop", paused ? "text-amber-400" : "text-red-400")
							: getIcon("record", hasSelectedSource ? "text-white/80" : "text-white/30")}
						{recording && (
							<span
								className={`${paused ? "text-amber-400" : "text-red-400"} inline-block w-[34px] text-left text-xs font-semibold tabular-nums`}
							>
								{formatTimePadded(elapsedSeconds)}
							</span>
						)}
					</div>
				</button>

				{recording && (
					<div className={`flex items-center gap-0.5 ${styles.electronNoDrag}`}>
						<Tooltip
							content={paused ? t("tooltips.resumeRecording") : t("tooltips.pauseRecording")}
						>
							<button className={hudAuxIconBtnClasses} onClick={togglePaused}>
								{getIcon(paused ? "resume" : "pause", paused ? "text-amber-400" : "text-white/60")}
							</button>
						</Tooltip>
						<Tooltip content={t("tooltips.restartRecording")}>
							<button className={hudAuxIconBtnClasses} onClick={restartRecording}>
								{getIcon("restart", "text-white/60")}
							</button>
						</Tooltip>
						<Tooltip content={t("tooltips.cancelRecording")}>
							<button className={hudAuxIconBtnClasses} onClick={cancelRecording}>
								{getIcon("cancel", "text-white/60")}
							</button>
						</Tooltip>
					</div>
				)}

				{!recording && (
					<>
						{/* Open video file */}
						<Tooltip content={t("tooltips.openVideoFile")}>
							<button
								className={`${hudIconBtnClasses} ${styles.electronNoDrag}`}
								onClick={openVideoFile}
							>
								{getIcon("videoFile", "text-white/60")}
							</button>
						</Tooltip>

						{/* Open project */}
						<Tooltip content={t("tooltips.openProject")}>
							<button
								className={`${hudIconBtnClasses} ${styles.electronNoDrag}`}
								onClick={openProjectFile}
							>
								{getIcon("folder", "text-white/60")}
							</button>
						</Tooltip>
					</>
				)}

				{/* Right sidebar controls */}
				<div className={`${hudSidebarClasses} ${styles.electronNoDrag}`}>
					<div className={`${styles.languageMenuContainer} ${styles.electronNoDrag}`}>
						<button
							ref={languageTriggerRef}
							type="button"
							aria-label={t("language")}
							aria-expanded={isLanguageMenuOpen}
							aria-haspopup="menu"
							onClick={() => setIsLanguageMenuOpen((open) => !open)}
							className={`h-8 w-8 rounded-lg border border-white/10 bg-white/5 text-white/85 shadow-none transition-colors hover:bg-white/10 ${styles.electronNoDrag}`}
						>
							<div className="flex w-full items-center justify-center">
								<Languages size={13} className="text-white/75" />
							</div>
						</button>
					</div>

					{isLanguageMenuOpen
						? createPortal(
								<div
									ref={languageMenuPanelRef}
									role="menu"
									className={`${styles.languageMenuPanel} ${styles.languageMenuScroll} ${styles.electronNoDrag}`}
									style={
										{
											WebkitAppRegion: "no-drag",
											pointerEvents: "auto",
											right: `${languageMenuStyle.right}px`,
											top: `${languageMenuStyle.top}px`,
											maxHeight: `${languageMenuStyle.maxHeight}px`,
										} as React.CSSProperties
									}
									onPointerDown={(event) => event.stopPropagation()}
								>
									{availableLocales.map((loc) => (
										<button
											key={loc}
											type="button"
											role="menuitemradio"
											aria-checked={loc === locale}
											onClick={() => {
												setLocale(loc);
												resolveSystemLocaleSuggestion();
												setIsLanguageMenuOpen(false);
											}}
											className={`${styles.languageMenuItem} ${loc === locale ? styles.languageMenuItemActive : ""}`}
										>
											<span className="truncate">{getLocaleName(loc)}</span>
											{loc === locale ? <Check size={11} className="text-white/85" /> : null}
										</button>
									))}
								</div>,
								document.body,
							)
						: null}

					{/* Window controls */}
					<div className="flex items-center gap-0.5">
						<button
							className={windowBtnClasses}
							title={t("tooltips.hideHUD")}
							onClick={sendHudOverlayHide}
						>
							{getIcon("minimize", "text-white")}
						</button>
						<button
							className={windowBtnClasses}
							title={t("tooltips.closeApp")}
							onClick={sendHudOverlayClose}
						>
							{getIcon("close", "text-white")}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
