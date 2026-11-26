"use client";

import { useEffect, useRef, useState } from "react";
import { Flashlight, FlashlightOff, X } from "lucide-react";
import { cn } from "@/components/ui/cn";

/**
 * Leitura de código de barras pela câmera do celular.
 *
 * Usa o BarcodeDetector nativo quando o navegador oferece (Chrome no Android) e,
 * no resto (Safari no iPhone, Firefox), a biblioteca ZXing carregada sob demanda.
 * A câmera só funciona em HTTPS (ou localhost) e depois que a pessoa permite.
 */

const FORMATS = ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "qr_code", "data_matrix"];
/**
 * A câmera vê a mesma etiqueta muitas vezes por segundo. Um código só é aceito de
 * novo depois de ficar este tempo fora de vista — vale também entre uma etapa e
 * outra (o endereço ainda na frente da câmera não é lido como produto).
 */
const OUT_OF_VIEW_MS = 2500;
const lastSeen = { code: "", at: 0 };

type Status = "starting" | "running" | "denied" | "unavailable";

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

export function CameraScanner({ onDetect, onClose }: { onDetect: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectRef = useRef(onDetect);
  const [status, setStatus] = useState<Status>("starting");
  const [torch, setTorch] = useState<{ on: boolean; track: MediaStreamTrack } | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    let zxingControls: { stop: () => void } | null = null;
    const emit = (raw: string) => {
      const code = raw.trim();
      const now = Date.now();
      if (!code) return;
      const repeated = code === lastSeen.code && now - lastSeen.at < OUT_OF_VIEW_MS;
      lastSeen.code = code;
      lastSeen.at = now;
      if (repeated) return;
      setFlash(true);
      window.setTimeout(() => setFlash(false), 220);
      onDetectRef.current(code);
    };

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unavailable");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        setStatus(err instanceof DOMException && err.name === "NotAllowedError" ? "denied" : "unavailable");
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setStatus("running");

      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
      if (caps.torch) setTorch({ on: false, track });

      const Native = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } })
        .BarcodeDetector;
      if (Native) {
        const supported = await Native.getSupportedFormats().catch(() => [] as string[]);
        const formats = FORMATS.filter((f) => supported.includes(f));
        if (formats.length) {
          const detector = new Native({ formats });
          const tick = async () => {
            if (stopped) return;
            if (video.readyState >= 2) {
              const found = await detector.detect(video).catch(() => []);
              if (found[0]) emit(found[0].rawValue);
            }
            timer = window.setTimeout(tick, 140);
          };
          tick();
          return;
        }
      }
      // Sem detector nativo: ZXing (carregado só aqui).
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      if (stopped) return;
      const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 300 });
      zxingControls = await reader.decodeFromVideoElement(video, (result) => {
        if (result) emit(result.getText());
      });
    }

    start();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      zxingControls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function toggleTorch() {
    if (!torch) return;
    const on = !torch.on;
    await torch.track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => undefined);
    setTorch({ ...torch, on });
  }

  if (status === "denied" || status === "unavailable") {
    return (
      <div role="status" className="flex items-start gap-3 rounded-lg border border-line-strong bg-surface p-4 text-base text-fg">
        <span className="flex-1">
          {status === "denied"
            ? "A câmera foi bloqueada. Libere a câmera para este site nas configurações do navegador, ou digite o código."
            : "A câmera não está disponível neste aparelho. Use o leitor ou digite o código."}
        </span>
        <button type="button" onClick={onClose} aria-label="Fechar câmera" className="rounded-full p-1 text-fg-2 hover:bg-subtle">
          <X className="size-6" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-fg bg-noite-900">
      <video ref={videoRef} muted playsInline aria-label="Imagem da câmera" className="block aspect-[4/3] w-full object-cover" />
      {/* Moldura de mira com a linha de leitura */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className={cn(
            "relative h-[38%] w-[78%] rounded-lg border transition-colors [container-type:size]",
            flash ? "border-ok-solid bg-ok-solid/20" : "border-creme-100/90",
          )}
        >
          <span className="collector-laser absolute inset-x-2 h-0.5 bg-crit-solid shadow-[0_0_8px] shadow-crit-solid" />
        </div>
      </div>
      <p className="absolute inset-x-0 bottom-0 bg-noite-900/75 px-4 py-2 text-center text-base text-creme-100">
        {status === "starting" ? "Abrindo a câmera…" : "Aponte para a etiqueta"}
      </p>
      <div className="absolute top-2 right-2 flex gap-2">
        {torch ? (
          <button
            type="button"
            onClick={toggleTorch}
            aria-pressed={torch.on}
            aria-label={torch.on ? "Desligar lanterna" : "Ligar lanterna"}
            className="grid size-11 place-items-center rounded-full bg-noite-900/75 text-creme-100"
          >
            {torch.on ? <FlashlightOff className="size-5" aria-hidden /> : <Flashlight className="size-5" aria-hidden />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar câmera"
          className="grid size-11 place-items-center rounded-full bg-noite-900/75 text-creme-100"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * Celular com câmera e sem leitor físico: abre a câmera sozinho. A escolha da
 * pessoa (abrir ou fechar a câmera) fica guardada neste aparelho.
 */
const PREF_KEY = "orion.coletor.camera";

export function cameraPreferred(): boolean {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const saved = window.localStorage.getItem(PREF_KEY);
    if (saved === "on") return true;
    if (saved === "off") return false;
  } catch {
    /* armazenamento indisponível: segue a regra do aparelho */
  }
  const touch = window.matchMedia("(pointer: coarse)").matches;
  // Coletores Android dedicados têm leitor físico: não abre a câmera por padrão.
  const dedicated = /Zebra|Honeywell|Datalogic|CipherLab|Urovo|Sunmi|Chainway|Newland|Point Mobile/i.test(navigator.userAgent);
  return touch && !dedicated;
}

export function saveCameraPreference(on: boolean) {
  try {
    window.localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    /* ignora */
  }
}
