import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { desktop } from './desktop';

// Casting backends, picked by environment:
//  - native:  desktop app; the Electron main process speaks the Cast protocol directly (Chromecast)
//  - chrome:  Chrome/Edge in a browser; Google Cast Web Sender SDK (Chromecast)
//  - airplay: Safari; the video element itself is sent to an AirPlay device

export type CastKind = 'native' | 'chrome' | 'airplay';
export type CastState =
  | 'idle'
  | 'connecting'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended'
  | 'error'
  | 'disconnected';

export type CastStatus = {
  state: CastState;
  deviceName?: string;
  currentTime: number;
  duration: number;
  error?: string;
};

export type CastDevice = { id: string; name: string; model?: string };

export type CastMedia = {
  url: string;
  filename?: string;
  title: string;
  subtitle?: string;
  poster?: string;
  startTime: number;
  /** WebVTT text of the selected subtitle track (native casting serves it to the TV). */
  subtitleVtt?: string;
  subtitleLang?: string;
};

export type CastAction = 'play' | 'pause' | 'seek' | 'volume' | 'stop';

const IDLE: CastStatus = { state: 'idle', currentTime: 0, duration: 0 };
const ACTIVE: CastState[] = ['connecting', 'playing', 'paused', 'buffering'];
export const isCastActive = (s: CastStatus) => ACTIVE.includes(s.state);

// ---------- Google Cast Web Sender SDK (loaded on demand) ----------
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __onGCastApiAvailable?: (available: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}

let sdkPromise: Promise<boolean> | null = null;

/** Chrome and Edge (both report Chrome/ in the user agent) can host the Cast SDK. */
function isChromeBrowser() {
  return !desktop && !!window.chrome && /Chrome\//.test(navigator.userAgent);
}

function loadCastSdk(): Promise<boolean> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve) => {
    window.__onGCastApiAvailable = (available) => {
      if (available) {
        window.cast.framework.CastContext.getInstance().setOptions({
          receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });
      }
      resolve(available);
    };
    const script = document.createElement('script');
    script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    script.async = true;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return sdkPromise;
}

function contentTypeFor(url: string, filename?: string) {
  const name = `${filename ?? ''} ${url}`.toLowerCase();
  if (/\.m3u8(\?|\s|$)/.test(name)) return 'application/x-mpegURL';
  if (/\.webm(\?|\s|$)/.test(name)) return 'video/webm';
  if (/\.mkv(\?|\s|$)/.test(name)) return 'video/x-matroska';
  return 'video/mp4';
}

// ---------- Hook ----------
export function useCast(videoRef: RefObject<HTMLVideoElement>) {
  const nativeCast = desktop?.cast;
  const [kind, setKind] = useState<CastKind | null>(nativeCast ? 'native' : null);
  const [available, setAvailable] = useState(!!nativeCast);
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [status, setStatus] = useState<CastStatus>(IDLE);
  const remote = useRef<{ player: any; controller: any } | null>(null);

  // Native: device list + status pushed from the main process.
  useEffect(() => {
    if (!nativeCast) return;
    const offStatus = nativeCast.onStatus((s) => setStatus((prev) => ({ ...prev, ...s })));
    const offDevices = nativeCast.onDevices(setDevices);
    nativeCast.devices().then(setDevices);
    return () => {
      offStatus();
      offDevices();
    };
  }, [nativeCast]);

  // Chrome: load the Cast SDK and track whether any receivers are around.
  useEffect(() => {
    if (nativeCast || !isChromeBrowser()) return;
    let alive = true;
    let cleanup: (() => void) | undefined;
    loadCastSdk().then((ok) => {
      if (!ok || !alive) return;
      const fw = window.cast.framework;
      const ctx = fw.CastContext.getInstance();
      const onState = () => setAvailable(ctx.getCastState() !== fw.CastState.NO_DEVICES_AVAILABLE);
      ctx.addEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, onState);
      onState();
      setKind('chrome');

      const player = new fw.RemotePlayer();
      const controller = new fw.RemotePlayerController(player);
      remote.current = { player, controller };
      const onChange = () => {
        if (!player.isConnected) {
          setStatus((prev) => (isCastActive(prev) ? { ...prev, state: 'disconnected' } : prev));
          return;
        }
        const ps = player.playerState as string | null;
        const state: CastState =
          ps === 'PLAYING' ? 'playing' : ps === 'PAUSED' ? 'paused' : ps === 'BUFFERING' ? 'buffering' : ps === 'IDLE' ? 'idle' : 'connecting';
        setStatus({
          state,
          currentTime: player.currentTime ?? 0,
          duration: player.duration ?? 0,
          deviceName: ctx.getCurrentSession()?.getCastDevice()?.friendlyName,
        });
      };
      controller.addEventListener(fw.RemotePlayerEventType.ANY_CHANGE, onChange);
      cleanup = () => {
        ctx.removeEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, onState);
        controller.removeEventListener(fw.RemotePlayerEventType.ANY_CHANGE, onChange);
      };
    });
    return () => {
      alive = false;
      cleanup?.();
    };
  }, [nativeCast]);

  // Safari: AirPlay picker on the video element.
  useEffect(() => {
    const el = videoRef.current as (HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void }) | null;
    if (nativeCast || !el || !el.webkitShowPlaybackTargetPicker) return;
    setKind('airplay');
    const onAvail = (e: Event) => setAvailable((e as Event & { availability: string }).availability === 'available');
    el.addEventListener('webkitplaybacktargetavailabilitychanged', onAvail);
    return () => el.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvail);
  }, [nativeCast, videoRef]);

  const refreshDevices = useCallback(() => {
    nativeCast?.devices().then(setDevices);
  }, [nativeCast]);

  const start = useCallback(
    async (media: CastMedia, deviceId?: string): Promise<string | null> => {
      if (kind === 'native' && nativeCast && deviceId) {
        const name = devices.find((d) => d.id === deviceId)?.name;
        setStatus({ state: 'connecting', currentTime: media.startTime, duration: 0, deviceName: name });
        const res = await nativeCast.load({ ...media, deviceId });
        return res.ok ? null : res.error ?? 'Casting failed';
      }
      if (kind === 'chrome') {
        const ctx = window.cast.framework.CastContext.getInstance();
        try {
          await ctx.requestSession();
        } catch {
          return null; // picker dismissed
        }
        const c = window.chrome.cast;
        const info = new c.media.MediaInfo(media.url, contentTypeFor(media.url, media.filename));
        const meta = new c.media.GenericMediaMetadata();
        meta.title = media.title;
        meta.subtitle = media.subtitle;
        if (media.poster) meta.images = [new c.Image(media.poster)];
        info.metadata = meta;
        const request = new c.media.LoadRequest(info);
        request.currentTime = media.startTime;
        request.autoplay = true;
        try {
          setStatus((s) => ({ ...s, state: 'connecting' }));
          await ctx.getCurrentSession().loadMedia(request);
          return null;
        } catch (err) {
          setStatus(IDLE);
          return `The device couldn't play this stream (${String(err)}).`;
        }
      }
      if (kind === 'airplay') {
        (videoRef.current as HTMLVideoElement & { webkitShowPlaybackTargetPicker: () => void }).webkitShowPlaybackTargetPicker();
      }
      return null;
    },
    [kind, nativeCast, devices, videoRef],
  );

  const control = useCallback(
    (action: CastAction, value?: number) => {
      if (kind === 'native') return nativeCast?.control(action, value);
      if (kind !== 'chrome' || !remote.current) return;
      const { player, controller } = remote.current;
      switch (action) {
        case 'play':
          if (player.isPaused) controller.playOrPause();
          break;
        case 'pause':
          if (!player.isPaused) controller.playOrPause();
          break;
        case 'seek':
          player.currentTime = value ?? 0;
          controller.seek();
          break;
        case 'volume':
          player.volumeLevel = value ?? 1;
          controller.setVolumeLevel();
          break;
        case 'stop':
          window.cast.framework.CastContext.getInstance().endCurrentSession(true);
          setStatus((s) => ({ ...s, state: 'disconnected' }));
      }
    },
    [kind, nativeCast],
  );

  return { kind, available, devices, refreshDevices, status, start, control };
}
