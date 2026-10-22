import type { CastAction, CastDevice, CastMedia, CastStatus } from './cast';
import type { EpisodeRef, IntroDbResponse } from './segments';

export type AudioTrackInfo = {
  index: number;
  codec: string;
  language: string;
  channels: string;
  title: string;
  isDefault: boolean;
  /** Whether the built-in player can decode it (false for Dolby Digital / DTS / TrueHD). */
  supported: boolean;
};

/** What ffmpeg found in a stream, plus where to request converted playback. */
export type MediaProbe = {
  duration: number;
  videoCodec: string | null;
  audio: AudioTrackInfo[];
  /** Request `${base}?start=<seconds>&audio=<track index>` for video copy + AAC audio. */
  base: string;
};

/** What the start of an MKV file says about an audio track (no title or channel layout). */
export type TrackSummary = Pick<AudioTrackInfo, 'index' | 'codec' | 'language' | 'isDefault' | 'supported'>;

export type UpdateState = {
  state: 'disabled' | 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error';
  current: string;
  version?: string;
  notes?: string;
  /** 0..1 while downloading */
  progress?: number;
  /** Release page, when this copy can't install the update itself */
  page?: string;
  error?: string;
};

// Bridge exposed by electron/preload.cjs; undefined when running in a browser.
type DesktopBridge = {
  platform: string;
  cast: {
    devices: () => Promise<CastDevice[]>;
    load: (media: CastMedia & { deviceId: string }) => Promise<{ ok: boolean; error?: string }>;
    control: (action: CastAction, value?: number) => void;
    onStatus: (callback: (status: Partial<CastStatus>) => void) => () => void;
    onDevices: (callback: (devices: CastDevice[]) => void) => () => void;
  };
  segments?: (ref: EpisodeRef) => Promise<IntroDbResponse | null>;
  updates?: {
    get: () => Promise<UpdateState>;
    check: () => Promise<UpdateState>;
    install: () => Promise<{ ok: boolean; error?: string }>;
    onState: (callback: (state: UpdateState) => void) => () => void;
  };
  media?: {
    /**
     * The link's final address after redirects, resolved once (debrid links have a slow first hop),
     * plus its audio tracks when the start of the file lists them (MKV); null means unknown.
     */
    resolve: (
      url: string,
      headers?: Record<string, string>,
    ) => Promise<{ url: string; audio: TrackSummary[] | null }>;
    /** A conversion link created instantly (no network), for starting conversion before the check. */
    open: (url: string, headers?: Record<string, string>) => Promise<{ base: string } | null>;
    prepare: (url: string, headers?: Record<string, string>) => Promise<MediaProbe | null>;
    /** Where converted playback requested at `start` really begins (the keyframe at or before it). */
    startPoint: (base: string, start: number, audio: number) => Promise<number>;
  };
  onNavigate: (callback: (route: string) => void) => () => void;
  ready: () => void;
};

declare global {
  interface Window {
    movieplexDesktop?: DesktopBridge;
  }
}

export const desktop = window.movieplexDesktop;
