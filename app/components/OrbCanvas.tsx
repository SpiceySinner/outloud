"use client";

import { useEffect, useRef } from "react";

type OrbState =
  | "idle"
  | "ready"
  | "listening"
  | "still-listening"
  | "thinking"
  | "speaking"
  | "quiet";

type OrbCanvasProps = {
  state?: OrbState;
  className?: string;
  size?: number;
  "aria-label"?: string;
};

type OrbConfig = {
  amp: number;
  spin: number;
  tilt: number;
  funnel: number;
  scale: number;
  dot: number;
  alpha: number;
  pal: [number, number, number][];
  glow: string;
  beat: boolean;
};

const ORB_CONFIGS: Record<OrbState, OrbConfig> = {
  idle: {
    amp: 0.12,
    spin: 0.1,
    tilt: 0.05,
    funnel: 0,
    scale: 0.4,
    dot: 1.5,
    alpha: 0.95,
    pal: [
      [62, 107, 69],
      [176, 46, 96],
      [206, 96, 40],
    ],
    glow: "rgba(206,150,170,.1)",
    beat: false,
  },
  ready: {
    amp: 0.15,
    spin: 0.13,
    tilt: 0.07,
    funnel: 0,
    scale: 0.48,
    dot: 1.7,
    alpha: 1,
    pal: [
      [56, 102, 64],
      [182, 40, 92],
      [200, 88, 36],
    ],
    glow: "rgba(200,150,164,.1)",
    beat: false,
  },
  listening: {
    amp: 0.11,
    spin: 0.09,
    tilt: 0.04,
    funnel: 0.86,
    scale: 0.5,
    dot: 1.7,
    alpha: 1,
    pal: [
      [56, 104, 68],
      [112, 124, 152],
      [176, 52, 118],
    ],
    glow: "rgba(150,176,146,.1)",
    beat: false,
  },
  "still-listening": {
    amp: 0.09,
    spin: 0.06,
    tilt: 0.03,
    funnel: 0.96,
    scale: 0.5,
    dot: 1.7,
    alpha: 1,
    pal: [
      [62, 110, 74],
      [122, 108, 168],
      [170, 48, 114],
    ],
    glow: "rgba(160,140,186,.1)",
    beat: false,
  },
  thinking: {
    amp: 0.17,
    spin: 0.46,
    tilt: 0.3,
    funnel: 0,
    scale: 0.34,
    dot: 1.5,
    alpha: 0.9,
    pal: [
      [196, 104, 148],
      [124, 164, 126],
      [208, 138, 116],
    ],
    glow: "rgba(196,120,150,.09)",
    beat: false,
  },
  speaking: {
    amp: 0.27,
    spin: 0.19,
    tilt: 0.09,
    funnel: 0,
    scale: 0.56,
    dot: 1.8,
    alpha: 1,
    pal: [
      [196, 69, 31],
      [226, 126, 76],
      [63, 107, 71],
    ],
    glow: "rgba(220,110,72,.13)",
    beat: true,
  },
  quiet: {
    amp: 0.07,
    spin: 0,
    tilt: 0,
    funnel: 0,
    scale: 0.38,
    dot: 1.4,
    alpha: 0.72,
    pal: [
      [138, 132, 124],
      [158, 150, 140],
      [126, 120, 112],
    ],
    glow: "rgba(150,144,136,.1)",
    beat: false,
  },
};

const POINT_COUNT = 4400;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function createPoints() {
  return Array.from({ length: POINT_COUNT }, (_, i) => {
    const y = 1 - (i / (POINT_COUNT - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const p = i * GOLDEN_ANGLE;
    return [Math.cos(p) * r, y, Math.sin(p) * r] as const;
  });
}

function paint(
  canvas: HTMLCanvasElement,
  points: readonly (readonly [number, number, number])[],
  config: OrbConfig,
  time: number,
) {
  const context = canvas.getContext("2d");
  if (!context) return;

  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);

  const centerX = width / 2;
  const centerY = height / 2;
  let radius = Math.min(width, height) * 0.5 * config.scale;
  const beat = config.beat
    ? 1 + Math.sin(time * 7.4) * 0.045 + Math.sin(time * 3.1) * 0.03
    : 1 + Math.sin(time * 0.9) * 0.012;

  radius *= beat;

  const glow = context.createRadialGradient(
    centerX,
    centerY,
    radius * 0.15,
    centerX,
    centerY,
    radius * 1.75,
  );
  glow.addColorStop(0, config.glow);
  glow.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(centerX, centerY, radius * 1.75, 0, Math.PI * 2);
  context.fill();

  const yaw = time * config.spin;
  const pitch = Math.sin(time * config.tilt * 2.2) * 0.5 + 0.22;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  const projected = points.map(([x0, y0, z0]) => {
    const distortion =
      1 +
      config.amp *
        (Math.sin(x0 * 2.7 + time * 0.8) *
          Math.sin(y0 * 2.3 - time * 0.6) *
          0.6 +
          Math.sin(z0 * 3.4 + time * 0.5) * 0.4);
    let x = x0 * distortion;
    let y = y0 * distortion;
    let z = z0 * distortion;

    if (config.funnel > 0 && y < 0) {
      const pull = Math.pow(-y, 1.55) * config.funnel;
      x *= 1 - pull;
      z *= 1 - pull;
      y -= pull * 0.26;
    }

    const rotatedX = x * cosYaw - z * sinYaw;
    let rotatedZ = x * sinYaw + z * cosYaw;
    const rotatedY = y * cosPitch - rotatedZ * sinPitch;
    rotatedZ = y * sinPitch + rotatedZ * cosPitch;

    const perspective = 2.6 / (2.6 - rotatedZ * 0.62);
    return [
      centerX + rotatedX * radius * perspective,
      centerY + rotatedY * radius * perspective,
      rotatedZ,
      perspective,
      (rotatedX * 0.62 - rotatedY * 0.78 + 1) / 2,
    ] as const;
  });

  projected.sort((a, b) => a[2] - b[2]);
  const [first, second, third] = config.pal;

  projected.forEach(([x, y, z, perspective, light]) => {
    const u = Math.min(1, Math.max(0, light));
    let mix: number;
    let r: number;
    let g: number;
    let b: number;

    if (u < 0.5) {
      mix = u * 2;
      r = first[0] + (second[0] - first[0]) * mix;
      g = first[1] + (second[1] - first[1]) * mix;
      b = first[2] + (second[2] - first[2]) * mix;
    } else {
      mix = (u - 0.5) * 2;
      r = second[0] + (third[0] - second[0]) * mix;
      g = second[1] + (third[1] - second[1]) * mix;
      b = second[2] + (third[2] - second[2]) * mix;
    }

    const depth = Math.min(1, Math.max(0, (z + 1) / 2));
    const alpha = config.alpha * (0.3 + 0.7 * Math.pow(depth, 1.1));
    const size = config.dot * 1.36 * (0.62 + 0.62 * depth) * perspective;

    context.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha.toFixed(3)})`;
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    context.fill();
  });

  if (config.funnel > 0) {
    const funnelY = centerY + radius * (0.86 + config.funnel * 0.2);
    const funnelRadius = radius * 0.42;
    const funnelGlow = context.createRadialGradient(
      centerX,
      funnelY,
      0,
      centerX,
      funnelY,
      funnelRadius,
    );
    funnelGlow.addColorStop(0, "rgba(255,252,246,.95)");
    funnelGlow.addColorStop(0.35, "rgba(255,236,214,.5)");
    funnelGlow.addColorStop(1, "rgba(255,236,214,0)");
    context.fillStyle = funnelGlow;
    context.beginPath();
    context.arc(centerX, funnelY, funnelRadius, 0, Math.PI * 2);
    context.fill();
  }

  if (config.beat) {
    for (let i = 0; i < 3; i += 1) {
      const phase = (time * 0.5 + i / 3) % 1;
      context.strokeStyle = `rgba(226,146,110,${(0.3 * (1 - phase)).toFixed(3)})`;
      context.lineWidth = 1.4;
      context.beginPath();
      context.ellipse(
        centerX,
        centerY,
        radius * (1.02 + phase * 0.5),
        radius * (0.92 + phase * 0.42),
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
  }
}

export function OrbCanvas({
  state = "ready",
  className,
  size = 680,
  "aria-label": ariaLabel = "OutLoud orb",
}: OrbCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef(createPoints());
  // The state is read through a ref inside the loop so the render effect never re-runs on a state
  // change. Keyed on [state], it restarted the animation clock every transition, which snapped the
  // orb's rotation and breathing phase back to zero -- visible as a hitch on every turn change.
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let frame = 0;
    const startedAt = performance.now();

    const loop = (now: number) => {
      const canvas = canvasRef.current;
      if (canvas) {
        paint(canvas, pointsRef.current, ORB_CONFIGS[stateRef.current], (now - startedAt) / 1000);
      }
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={ariaLabel}
    />
  );
}
