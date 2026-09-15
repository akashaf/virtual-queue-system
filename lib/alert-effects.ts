"use client";

import { useEffect, useRef } from "react";
import type { PageAlerts } from "@/lib/alerts";

/** How often the Called chime repeats until "I'm coming" is tapped (frontend.md §3.3). */
const CALLED_REPEAT_MS = 5_000;

/** A Heads-up is one chime; its title flash only needs to outlast a glance away. */
const HEADS_UP_FLASH_MS = 10_000;

const TITLE_FLASH_MS = 1_000;

const HEADS_UP_VIBRATION = [200, 100, 200];
const CALLED_VIBRATION = [500, 200, 500];

/**
 * Acts on what `lib/alerts.ts` decided: sound, vibration, a flashing tab title,
 * and a screen kept awake while there is a Ticket to be alerted about.
 *
 * Everything here is best effort. iPhone Safari in a tab gets no Web Push
 * (ADR 0001), so this is its only alert, and any one piece — a wake lock, a
 * vibration motor — may simply not exist.
 */
export function useAlertEffects(
  alerts: PageAlerts,
  {
    headsUpTitle,
    calledTitle,
    keepAwake,
  }: { headsUpTitle: string; calledTitle: string; keepAwake: boolean },
): void {
  // Held in refs so switching language mid-alert neither chimes again nor
  // restarts the ringing: only a new Ticket id should do either.
  const titles = useRef({ headsUpTitle, calledTitle });
  useEffect(() => {
    titles.current = { headsUpTitle, calledTitle };
  }, [headsUpTitle, calledTitle]);

  useEffect(() => {
    if (alerts.headsUpTicketId === null) return;

    playSound("heads_up");
    vibrate(HEADS_UP_VIBRATION);
    return flashTitle(titles.current.headsUpTitle, HEADS_UP_FLASH_MS);
  }, [alerts.headsUpTicketId]);

  useEffect(() => {
    if (alerts.ringingTicketId === null) return;

    const ring = () => {
      playSound("called");
      vibrate(CALLED_VIBRATION);
    };
    ring();
    const repeat = setInterval(ring, CALLED_REPEAT_MS);
    const stopFlashing = flashTitle(titles.current.calledTitle);

    return () => {
      clearInterval(repeat);
      stopFlashing();
    };
  }, [alerts.ringingTicketId]);

  useWakeLock(keepAwake);

  // The Join tap unlocks audio, but a Customer who reloads the page while
  // waiting never makes that tap again. Any tap on the page will do as well.
  useEffect(() => {
    if (!keepAwake) return;
    document.addEventListener("pointerdown", unlockAudio, { once: true });
    return () => document.removeEventListener("pointerdown", unlockAudio);
  }, [keepAwake]);
}

/**
 * Requests a screen wake lock while `active`, and again whenever the tab comes
 * back: the browser releases the lock itself as soon as the page is hidden.
 */
function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let stopped = false;

    const request = async () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (stopped) void sentinel.release();
        else lock = sentinel;
      } catch {
        // Refused — low battery, or a browser policy. The page still alerts.
      }
    };

    void request();
    document.addEventListener("visibilitychange", request);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", request);
      void lock?.release();
    };
  }, [active]);
}

function vibrate(pattern: number[]): void {
  // iPhone Safari has no vibration at all.
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

type Sound = "silent" | "heads_up" | "called";

/**
 * One element for every sound. iOS only lets a page play audio from an element
 * that has already played inside a tap, so the silent clip the Join tap plays
 * is what lets the chimes play later on the same element (frontend.md §3.2).
 *
 * An `<audio>` element rather than Web Audio, because iOS mutes Web Audio when
 * the ring switch is on silent and does not mute media playback.
 */
let player: HTMLAudioElement | null = null;
const soundUrls = new Map<Sound, string>();

/** Plays the silent clip. Call it synchronously inside a tap handler. */
export function unlockAudio(): void {
  playSound("silent");
}

function playSound(sound: Sound): void {
  if (typeof Audio === "undefined") return;

  player ??= new Audio();
  player.src = soundUrl(sound);
  // Autoplay refused — no tap has unlocked audio yet. Vibration and the title
  // still carry the alert, and the Called screen is a full-screen colour change.
  player.play().catch(() => {});
}

function soundUrl(sound: Sound): string {
  let url = soundUrls.get(sound);
  if (!url) {
    url = URL.createObjectURL(toWav(SOUNDS[sound]()));
    soundUrls.set(sound, url);
  }
  return url;
}

const SAMPLE_RATE = 22_050;

/**
 * The sounds, synthesised rather than shipped as files: two short chimes are a
 * few lines of arithmetic, and there is no audio asset to keep in step.
 */
const SOUNDS: Record<Sound, () => Float32Array> = {
  silent: () => new Float32Array(SAMPLE_RATE / 10),
  // A soft two-note "ding-dong".
  heads_up: () => tones([880, 660], 0.35, 0.5),
  // Louder, higher and twice as long: this one has to be heard across a room.
  called: () => tones([988, 784, 988, 784], 0.25, 1),
};

/** Sine notes one after another, each struck and left to decay like a bell. */
function tones(frequencies: number[], noteSeconds: number, volume: number): Float32Array {
  const perNote = Math.round(SAMPLE_RATE * noteSeconds);
  const samples = new Float32Array(perNote * frequencies.length);
  const attack = SAMPLE_RATE / 200;

  frequencies.forEach((frequency, note) => {
    for (let i = 0; i < perNote; i++) {
      const t = i / SAMPLE_RATE;
      const envelope = Math.min(1, i / attack) * Math.exp((-4 * t) / noteSeconds);
      samples[note * perNote + i] =
        volume * envelope * Math.sin(2 * Math.PI * frequency * t);
    }
  });

  return samples;
}

/** 16-bit mono PCM in a RIFF container: the one audio format every browser plays. */
function toWav(samples: Float32Array): Blob {
  const bytes = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  bytes.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  bytes.setUint32(16, 16, true); // fmt chunk size
  bytes.setUint16(20, 1, true); // PCM
  bytes.setUint16(22, 1, true); // mono
  bytes.setUint32(24, SAMPLE_RATE, true);
  bytes.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  bytes.setUint16(32, 2, true); // block align
  bytes.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  bytes.setUint32(40, samples.length * 2, true);

  samples.forEach((sample, i) => {
    bytes.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  });

  return new Blob([bytes.buffer], { type: "audio/wav" });
}

/**
 * The flash currently on the tab. One at a time: Called arriving while a
 * Heads-up still flashes takes the title over, and the Heads-up's own stop then
 * does nothing rather than putting its stale "original" back.
 */
let currentFlash: { stop: () => void } | null = null;

/** Alternates the tab title with `message` until stopped, or for `durationMs`. */
function flashTitle(message: string, durationMs?: number): () => void {
  currentFlash?.stop();

  const original = document.title;
  let showing = true;
  document.title = message;

  const toggle = setInterval(() => {
    showing = !showing;
    document.title = showing ? message : original;
  }, TITLE_FLASH_MS);
  const expire = durationMs === undefined ? undefined : setTimeout(stop, durationMs);

  const flash = { stop };
  currentFlash = flash;

  function stop() {
    if (currentFlash !== flash) return;
    clearInterval(toggle);
    clearTimeout(expire);
    document.title = original;
    currentFlash = null;
  }

  return stop;
}
