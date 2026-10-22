import Hls from 'hls.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchMeta, fetchSubtitles, subtitleAddons } from '../addons/client';
import type { MetaDetail, MetaPreview, Video } from '../addons/types';
import { Spinner } from '../components/Common';
import { Icon } from '../components/Icon';
import { isCastActive, useCast } from '../lib/cast';
import { AudioTrackInfo, desktop, MediaProbe, TrackSummary } from '../lib/desktop';
import { languageName, sameLanguage } from '../lib/languages';
import { findNextStream } from '../lib/nextStream';
import { checkServer, torrentUrl } from '../lib/streamingServer';
import { episodeRef, fetchSegments, Segment, Segments } from '../lib/segments';
import { activeCues, Cue, cuesToVtt, loadSubtitles, parseSubtitles } from '../lib/subtitles';
import {
  clamp,
  copyText,
  decodeStream,
  detailPath,
  episodeLabel,
  formatTime,
  nextVideo,
  playerPath,
  streamKind,
  videoTitle,
} from '../lib/util';
import { useAddons } from '../store/addons';
import { useLibrary } from '../store/library';
import { useProfiles } from '../store/profiles';
import { useSettings } from '../store/settings';
import { toast } from '../store/toast';

type SubTrack = { key: string; url: string; lang: string; origin: string };
type Menu = 'cast' | 'subtitles' | 'audio' | 'quality' | 'speed' | null;

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SAVE_INTERVAL_MS = 5000;
const UP_NEXT_SECONDS = 35;
const CODEC_NAMES: Record<string, string> = {
  ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', dts: 'DTS', truehd: 'Dolby TrueHD', mlp: 'Dolby TrueHD',
  aac: 'AAC', mp3: 'MP3', opus: 'Opus', flac: 'FLAC', vorbis: 'Vorbis',
};
const codecName = (codec: string) => CODEC_NAMES[codec] ?? codec.toUpperCase();
/** Stream names/titles that announce audio the built-in player can decode. */
const PLAYABLE_AUDIO_LABEL = /(^|[^a-z0-9])(aac|he-?aac|opus|mp3|flac|vorbis)([ .]?[1-7][ .][01])?([^a-z0-9]|$)/i;
/** How long a stream labelled with playable audio may play with no decoded audio before it's checked. */
const SILENCE_CHECK_MS = 2500;
/** The track to play: one in the preferred language when the file has it, otherwise its default. */
function pickAudio<T extends TrackSummary>(tracks: T[]): T | undefined {
  const preferred = useSettings.getState().audioLanguage;
  const matches = preferred ? tracks.filter((t) => sameLanguage(t.language, preferred)) : [];
  if (matches.length) return matches.find((t) => t.isDefault) ?? matches.find((t) => t.supported) ?? matches[0];
  return tracks.find((t) => t.isDefault) ?? tracks[0];
}
const fileDefault = <T extends TrackSummary>(tracks: T[]) => tracks.find((t) => t.isDefault) ?? tracks[0];
/** Chromium can switch a file's (playable) audio tracks itself; see main.cjs. */
const NATIVE_AUDIO_TRACKS = typeof HTMLMediaElement !== 'undefined' && 'audioTracks' in HTMLMediaElement.prototype;
type ElementAudioTracks = ArrayLike<{ enabled: boolean; language: string }>;

/** ffmpeg's channel layout ("5.1(side)", "6 channels") as people know it. */
const channelName = (layout: string) =>
  /^5\.1|^6 channels/.test(layout) ? '5.1' : /^7\.1|^8 channels/.test(layout) ? '7.1' : layout.replace(/\(.*\)$/, '');
/** Longest a loaded direct source waits for a slow audio check before playing anyway. */
const CHECK_HOLD_MS = 2000;
/** Stream names/titles that announce Dolby or DTS audio (e.g. "DDP5.1 Atmos", "DTS-HD MA", "TrueHD"). */
const UNPLAYABLE_AUDIO_LABEL =
  /(^|[^a-z0-9])(e-?ac-?3|ddp|dd\+|dd(?=[ .]?[257][ .][01])|ac-?3|dts|true-?hd|atmos|dolby[ .]?digital)([ .]?[257][ .][01])?([^a-z0-9]|$)/i;

/** Seconds the Up Next card counts down before the next episode starts. */
const AUTOPLAY_COUNTDOWN = 10;

export default function Player() {
  const params = useParams();
  const navigate = useNavigate();
  const type = params.type!;
  const id = params.id!;
  const videoId = params.videoId ?? id;
  const stream = useMemo(() => decodeStream(params.stream!), [params.stream]);
  const kind = stream ? streamKind(stream) : null;

  const addons = useAddons((s) => s.addons);
  const settings = useSettings();
  const updateProgress = useLibrary((s) => s.updateProgress);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  // While casting, the local video is paused and the controls drive the cast device.
  const castApi = useCast(videoRef);
  const casting = castApi.kind !== 'airplay' && isCastActive(castApi.status);
  const castRef = useRef({ casting, status: castApi.status, control: castApi.control });
  castRef.current = { casting, status: castApi.status, control: castApi.control };

  const [meta, setMeta] = useState<MetaDetail | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menu, setMenu] = useState<Menu>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);

  const [subTracks, setSubTracks] = useState<SubTrack[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [selectedSub, setSelectedSub] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [subDelay, setSubDelay] = useState(0);
  const userPickedSub = useRef(false);

  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string }[]>([]);
  // ---- Converted playback (desktop): ffmpeg copies the video and converts the audio to AAC ----
  // The element then plays a stream starting at `start`, so positions are offset by it.
  const [fileTracks, setFileTracks] = useState<AudioTrackInfo[]>([]);
  /** The ffmpeg check that lists the file's audio tracks is running. */
  const [checkingAudio, setCheckingAudio] = useState(false);
  const [conversion, setConversion] = useState<{ start: number; audio: number } | null>(null);
  const conversionRef = useRef<{ start: number; audio: number } | null>(null);
  conversionRef.current = conversion;
  const probeRef = useRef<MediaProbe | null>(null);
  const directSrc = useRef<string | null>(null);
  const seekTimer = useRef<number>();
  const conversionSeq = useRef(0);
  /** Position to jump to once a newly attached source has loaded (switching back to direct). */
  const seekOnLoad = useRef<number | null>(null);
  /** Where a debounced conversion restart will start; repeated seeks build on it. */
  const pendingSeek = useRef<number | null>(null);
  /** The file's audio tracks as far as known (from the start of the file, then the ffmpeg check). */
  const tracksRef = useRef<TrackSummary[]>([]);
  /** Track (ffmpeg's index) direct playback should play; applied when the element loads. */
  const wantedAudio = useRef<number | null>(null);
  /** Track direct playback is playing, once chosen. */
  const [directAudio, setDirectAudio] = useState<number | null>(null);
  /** A direct source is loaded paused until the audio check says whether it needs converting. */
  const holdForCheck = useRef(false);
  const [audioTrack, setAudioTrack] = useState(-1);
  const [levels, setLevels] = useState<{ id: number; name: string }[]>([]);
  const [level, setLevel] = useState(-1);
  const [speed, setSpeed] = useState(settings.playbackSpeed);
  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const [loadingNext, setLoadingNext] = useState(false);
  const autoplayed = useRef(false);
  /** Which stream the current position/length belong to; guards autoplay across episode changes. */
  const loadedStream = useRef<string | null>(null);
  const [segments, setSegments] = useState<Segments>({});
  const autoSkipped = useRef(new Set<string>());

  // ---- Intro / recap / credits timings for this episode ----
  useEffect(() => {
    setSegments({});
    autoSkipped.current.clear();
    const ref = type === 'series' ? episodeRef(videoId) : null;
    if (!ref || (!settings.skipButtons && !settings.autoSkipIntro)) return;
    let alive = true;
    fetchSegments(ref).then((s) => alive && setSegments(s));
    return () => {
      alive = false;
    };
  }, [type, videoId, settings.skipButtons, settings.autoSkipIntro]);

  // ---- Meta (title, next episode) ----
  useEffect(() => {
    let alive = true;
    fetchMeta(addons, type, id).then((res) => alive && res && setMeta(res.meta));
    return () => {
      alive = false;
    };
    // Addons rarely change mid-playback; avoid refetching on manifest refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id]);

  const video: Video | undefined = meta?.videos?.find((v) => v.id === videoId);
  const next = useMemo(() => (video ? nextVideo(meta?.videos, videoId) : undefined), [meta, video, videoId]);
  const metaPreview: MetaPreview = useMemo(
    () => meta ?? { id, type, name: stream?.title?.split('\n')[0] || id },
    [meta, id, type, stream],
  );

  // ---- Resolve the stream into a playable source ----
  useEffect(() => {
    if (!stream) {
      setError('This stream link is invalid.');
      return;
    }
    let alive = true;
    setError(null);
    setSrc(null);
    setBuffering(true);
    // Desktop streams get their audio tracks listed once the link resolves.
    setCheckingAudio(!!desktop?.media);
    const useDirect = (url: string) => {
      directSrc.current = url;
      const isHls = /\.m3u8($|\?)/i.test(url) || /m3u8/i.test(stream.behaviorHints?.filename ?? '');
      const media = desktop?.media;
      if (!media || isHls || !/^https?:/i.test(url)) {
        setCheckingAudio(false);
        return setSrc(url);
      }
      // Dolby / DTS audio plays silently in the built-in player, so ffmpeg converts it. Resolving the
      // link also reads the start of the file, which in MKV lists the audio tracks, so playback
      // starts on the right path (direct or converted) and never has to switch once it's showing.
      // Without that list, the addon's labels and the ffmpeg check decide.
      const headers = stream.behaviorHints?.proxyHeaders?.request;
      const label = [stream.name, stream.title, stream.description, stream.behaviorHints?.filename].join(' ');
      const labelled = UNPLAYABLE_AUDIO_LABEL.test(label);
      const playable = PLAYABLE_AUDIO_LABEL.test(label);
      const applyCheck = (info: MediaProbe) => {
        probeRef.current = info;
        tracksRef.current = info.audio;
        setFileTracks(info.audio);
        if (conversionRef.current) setDuration(info.duration);
        return pickAudio(info.audio);
      };
      /** The ffmpeg check: lists the audio tracks (cached, so repeat calls are instant). */
      const listTracks = () => {
        setCheckingAudio(true);
        return media.prepare(url, headers).finally(() => alive && setCheckingAudio(false));
      };
      /** Where converted playback starts: the saved position the first time, then the current one. */
      const startFrom = () => {
        if (resumed.current) return position();
        resumed.current = true;
        const saved = useLibrary.getState().items[id]?.state;
        const at =
          saved?.videoId === videoId && saved.timeOffset > 10 && saved.timeOffset < saved.duration - 30 ? saved.timeOffset : 0;
        if (at) toast(`Resumed from ${formatTime(at)}`);
        return at;
      };
      /** Plays a direct source that was loaded paused while the audio check ran. */
      const release = () => {
        if (!holdForCheck.current) return;
        holdForCheck.current = false;
        videoRef.current?.play().catch(() => setPlaying(false));
      };
      /**
       * The ffmpeg check. Converts when the chosen track can't play and either `decide` is set or
       * the track was chosen by language (the default would play silently or in the wrong language);
       * a playable choice switches the direct player's track.
       */
      const check = (decide: boolean) =>
        listTracks().then((info) => {
          if (!alive) return;
          const track = info ? applyCheck(info) : undefined;
          if (track && !conversionRef.current) {
            if (!track.supported && (decide || track !== fileDefault(info!.audio))) {
              holdForCheck.current = false;
              startConversion(track.index, startFrom());
              return;
            }
            if (track.supported) selectDirectTrack(track.index);
          }
          release();
        });
      /** Converted playback of `audio`; unless the track is `known`, the check may correct it. */
      const convert = (audio: number, known: boolean) => {
        media.open(url, headers).then((link) => {
          if (!alive) return;
          if (!link) {
            setCheckingAudio(false);
            return setSrc(directSrc.current);
          }
          const saved = useLibrary.getState().items[id]?.state;
          probeRef.current = { base: link.base, duration: saved?.duration ?? 0, videoCodec: null, audio: [] };
          startConversion(audio, startFrom());
          listTracks().then((info) => {
            if (!alive || !info) return;
            const track = applyCheck(info);
            if (!track || known) return;
            // Label was wrong: no conversion needed, play the original directly.
            if (track.supported) {
              wantedAudio.current = track.index;
              playDirectAt(directSrc.current!, position());
            } else if (track.index !== conversionRef.current?.audio) startConversion(track.index, position());
          });
        });
      };

      media.resolve(url, headers).then(({ url: final, audio }) => {
        if (!alive) return;
        directSrc.current = final;
        if (audio) tracksRef.current = audio;
        const track = audio ? pickAudio(audio) : undefined;
        if (track) {
          if (!track.supported) return convert(track.index, true);
          wantedAudio.current = track.index;
          setSrc(final);
          return void check(false); // only for the track list (switching language)
        }
        if (labelled) return convert(0, false);
        if (playable) {
          // Labelled with playable audio (AAC, Opus…): converts only if it plays without decoding
          // audio. The check still runs for the track list (switching language).
          setSrc(final);
          check(false);
          videoRef.current?.addEventListener(
            'playing',
            () =>
              setTimeout(() => {
                // Chromium-only decode counters: frames shown but no audio decoded means silent playback.
                const v = videoRef.current as (HTMLVideoElement & { webkitDecodedFrameCount: number; webkitAudioDecodedByteCount: number }) | null;
                if (alive && v && !conversionRef.current && v.webkitDecodedFrameCount > 0 && v.webkitAudioDecodedByteCount === 0) check(true);
              }, SILENCE_CHECK_MS),
            { once: true },
          );
          return;
        }
        // Unknown audio: load the picture paused until the check answers, so a Dolby stream doesn't
        // play silently for a moment and then restart converted. A slow check doesn't hold it long.
        holdForCheck.current = true;
        setSrc(final);
        videoRef.current?.addEventListener('canplay', () => setTimeout(() => alive && release(), CHECK_HOLD_MS), { once: true });
        check(true);
      });
    };
    (async () => {
      if (kind === 'url') {
        useDirect(stream.url!);
      } else if (kind === 'torrent') {
        const server = useProfiles.getState().streamingServerUrl;
        const serverUp = await checkServer(server);
        if (!serverUp) {
          if (alive)
            setError(
              `This is a torrent stream. Torrents need a Stremio-compatible streaming server running at ${server}. ` +
                'Start one (for example Stremio Service) or change the address in Settings.',
            );
          return;
        }
        const [, s, e] = videoId.split(':');
        const url = await torrentUrl(server, stream, s && e ? { season: +s, episode: +e } : undefined);
        if (alive) useDirect(url);
      }
    })().catch((err) => alive && setError(String(err?.message ?? err)));
    return () => {
      alive = false;
      holdForCheck.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.stream]);

  // ---- Attach the source (HLS via hls.js where the browser lacks native support) ----
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src) return;
    const isHls = /\.m3u8($|\?)/i.test(src) || /m3u8/i.test(stream?.behaviorHints?.filename ?? '');
    hlsRef.current?.destroy();
    hlsRef.current = null;
    setAudioTracks([]);
    setLevels([]);

    if (isHls && Hls.isSupported()) {
      const request = stream?.behaviorHints?.proxyHeaders?.request;
      const hls = new Hls({
        xhrSetup: request
          ? (xhr) => Object.entries(request).forEach(([k, v]) => {
              try {
                xhr.setRequestHeader(k, v);
              } catch {
                // forbidden header names are ignored by the browser
              }
            })
          : undefined,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLevels(
          hls.levels.map((l, i) => ({ id: i, name: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps` })),
        );
        setLevel(hls.currentLevel);
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        setAudioTracks(hls.audioTracks.map((t, i) => ({ id: i, name: t.name || languageName(t.lang ?? '') })));
        const preferred = useSettings.getState().audioLanguage;
        const match = preferred ? hls.audioTracks.findIndex((t) => sameLanguage(t.lang ?? '', preferred)) : -1;
        if (match >= 0 && match !== hls.audioTrack) hls.audioTrack = match;
        setAudioTrack(hls.audioTrack);
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setError(`Playback error (${data.details}).`);
      });
    } else {
      el.src = src;
    }
    el.playbackRate = speed;
    // A direct source waiting on the audio check stays paused (see useDirect).
    const held = !src.includes('/t/') && holdForCheck.current;
    if (!held) el.play().catch(() => setPlaying(false));
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // ---- Subtitles from addons + the stream itself ----
  useEffect(() => {
    if (!stream || kind === 'youtube') return;
    let alive = true;
    const embedded: SubTrack[] = (stream.subtitles ?? []).map((s, i) => ({
      key: `stream-${i}`,
      url: s.url,
      lang: s.lang,
      origin: 'Stream',
    }));
    setSubTracks(embedded);
    const providers = subtitleAddons(addons, type, videoId);
    setSubsLoading(providers.length > 0);
    const hints = stream.behaviorHints ?? {};
    const extra = {
      videoHash: hints.videoHash,
      videoSize: hints.videoSize,
      filename: hints.filename,
    };
    Promise.allSettled(
      providers.map((addon) =>
        fetchSubtitles(addon, type, videoId, extra).then((subs) =>
          subs.map((s, i) => ({ key: `${addon.manifest.id}-${s.id ?? i}`, url: s.url, lang: s.lang, origin: addon.manifest.name })),
        ),
      ),
    ).then((results) => {
      if (!alive) return;
      const fromAddons = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      setSubTracks([...embedded, ...fromAddons]);
      setSubsLoading(false);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.stream, videoId]);

  // Auto-select the preferred subtitle language.
  useEffect(() => {
    if (userPickedSub.current || selectedSub || !settings.subtitleLanguage) return;
    const match = subTracks.find((t) => sameLanguage(t.lang, settings.subtitleLanguage));
    if (match) setSelectedSub(match.key);
  }, [subTracks, selectedSub, settings.subtitleLanguage]);

  useEffect(() => {
    const track = subTracks.find((t) => t.key === selectedSub);
    if (!track) {
      setCues([]);
      return;
    }
    if (track.url.startsWith('blob:local')) return;
    let alive = true;
    loadSubtitles(track.url, useProfiles.getState().streamingServerUrl)
      .then((c) => alive && setCues(c))
      .catch(() => {
        if (!alive) return;
        setCues([]);
        toast('Could not load that subtitle track', 'error');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSub]);

  const loadLocalSubtitle = async (file: File) => {
    const text = await file.text();
    const parsed = parseSubtitles(text);
    if (!parsed.length) return toast('No subtitles found in that file', 'error');
    const key = `local-${file.name}-${Date.now()}`;
    setSubTracks((t) => [...t, { key, url: 'blob:local', lang: file.name, origin: 'Local file' }]);
    userPickedSub.current = true;
    setSelectedSub(key);
    setCues(parsed);
  };

  // ---- Position helpers (aware of converted playback) ----
  const position = () =>
    pendingSeek.current ?? (conversionRef.current?.start ?? 0) + (videoRef.current?.currentTime ?? 0);
  const mediaDuration = () => {
    if (conversionRef.current && probeRef.current) return probeRef.current.duration;
    const d = videoRef.current?.duration ?? 0;
    return isFinite(d) ? d : 0;
  };
  /** Starts converted playback of an audio track from (the keyframe at or before) `start` seconds. */
  const startConversion = (audio: number, start: number) => {
    const info = probeRef.current;
    if (!info) return;
    const seq = ++conversionSeq.current;
    const target = Math.max(0, Number(start.toFixed(3)));
    // Start straight away, timing from the requested point. The converted stream's clock really
    // starts at the keyframe ffmpeg begins from, which is looked up in parallel and corrected below.
    const next = { audio, start: target };
    pendingSeek.current = null;
    conversionRef.current = next;
    setConversion(next);
    setDuration(info.duration);
    setTime(target);
    setBuffering(true);
    setSrc(`${info.base}?start=${target.toFixed(3)}&audio=${audio}`);
    if (target <= 0) return;
    desktop!.media!.startPoint(info.base, target, audio).then((begins) => {
      if (seq !== conversionSeq.current) return; // superseded by a newer seek
      const exact = { audio, start: begins };
      conversionRef.current = exact;
      setConversion(exact);
      setTime(begins + (videoRef.current?.currentTime ?? 0));
    }, () => undefined);
  };
  /**
   * Plays file track `index` in direct playback by switching the element's own tracks. Chromium
   * lists only the tracks it can play, in file order. Before the element has loaded, this just
   * records the choice (applied in onLoadedMetadata). False when the switch isn't possible.
   */
  const selectDirectTrack = (index: number) => {
    wantedAudio.current = index;
    const el = videoRef.current;
    if (!el || el.readyState < HTMLMediaElement.HAVE_METADATA) return true;
    const list = (el as HTMLVideoElement & { audioTracks?: ElementAudioTracks }).audioTracks;
    const playable = tracksRef.current.filter((t) => t.supported);
    const k = playable.findIndex((t) => t.index === index);
    if (!list || k < 0 || list.length !== playable.length) return false;
    if (playable[k].language && list[k].language && !sameLanguage(playable[k].language, list[k].language)) return false;
    for (let i = 0; i < list.length; i++) list[i].enabled = i === k;
    setDirectAudio(index);
    return true;
  };
  /** Leaves converted playback and plays the original stream from `at` seconds. */
  const playDirectAt = (url: string, at: number) => {
    conversionSeq.current++;
    pendingSeek.current = null;
    conversionRef.current = null;
    setConversion(null);
    seekOnLoad.current = at;
    setSrc(url);
  };

  /** Seeks, restarting the conversion when active (debounced so dragging doesn't spawn many). */
  const seekLocal = (t: number) => {
    const conv = conversionRef.current;
    if (!conv) {
      if (videoRef.current) videoRef.current.currentTime = t;
      return;
    }
    setTime(t);
    pendingSeek.current = t;
    window.clearTimeout(seekTimer.current);
    seekTimer.current = window.setTimeout(() => startConversion(conv.audio, t), 300);
  };

  // ---- Progress & resume ----
  const resumed = useRef(false);
  const save = useCallback(() => {
    const cast = castRef.current;
    if (cast.casting) {
      const { currentTime, duration: d } = cast.status;
      if (d > 0 && currentTime >= 5) updateProgress(metaPreview, videoId, currentTime, d);
      return;
    }
    // While the next episode is loading, the element still holds the previous one's position.
    if (loadedStream.current !== params.stream) return;
    const d = mediaDuration();
    const t = position();
    if (!videoRef.current || !d || t < 5) return;
    updateProgress(metaPreview, videoId, t, d);
  }, [metaPreview, videoId, updateProgress, params.stream]);

  useEffect(() => {
    const t = setInterval(() => {
      if (castRef.current.casting || (videoRef.current && !videoRef.current.paused)) save();
    }, SAVE_INTERVAL_MS);
    return () => {
      clearInterval(t);
      save();
    };
  }, [save]);

  const onLoadedMetadata = () => {
    const el = videoRef.current!;
    loadedStream.current = params.stream ?? null;
    setDuration(mediaDuration() || el.duration);
    if (seekOnLoad.current !== null) {
      el.currentTime = seekOnLoad.current;
      seekOnLoad.current = null;
    }
    // Direct playback of a track other than the one the element picked: switch to it, or convert
    // when the element can't (it then plays the file's default).
    const wanted = wantedAudio.current;
    if (!conversionRef.current && wanted !== null && !selectDirectTrack(wanted)) {
      const fallback = fileDefault(tracksRef.current);
      if (fallback && wanted !== fallback.index) startConversion(wanted, position());
    }
    if (resumed.current) return;
    resumed.current = true;
    const state = useLibrary.getState().items[id]?.state;
    if (state?.videoId === videoId && state.timeOffset > 10 && state.timeOffset < (mediaDuration() || el.duration) - 30) {
      seekLocal(state.timeOffset);
      toast(`Resumed from ${formatTime(state.timeOffset)}`);
    }
  };

  // ---- Controls ----
  const hideTimer = useRef<number>();
  const menuRef = useRef<Menu>(null);
  menuRef.current = menu;
  const poke = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      // Keep controls up while a menu is open.
      if (videoRef.current && !videoRef.current.paused && !menuRef.current) setControlsVisible(false);
    }, 3000);
  }, []);

  useEffect(() => {
    if (!menu) poke();
  }, [menu, poke]);

  const togglePlay = useCallback(() => {
    const cast = castRef.current;
    if (cast.casting) return cast.control(cast.status.state === 'playing' ? 'pause' : 'play');
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => undefined);
    else el.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const cast = castRef.current;
    if (cast.casting) {
      const max = cast.status.duration || Infinity;
      return cast.control('seek', clamp(cast.status.currentTime + delta, 0, max));
    }
    const d = mediaDuration();
    if (!videoRef.current || !d) return;
    seekLocal(clamp(position() + delta, 0, d));
  }, []);

  const setVol = (v: number) => {
    if (casting) {
      castApi.control('volume', clamp(v, 0, 1));
      setVolume(clamp(v, 0, 1));
      return;
    }
    const el = videoRef.current;
    if (!el) return;
    el.volume = clamp(v, 0, 1);
    el.muted = el.volume === 0;
  };

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current?.requestFullscreen?.();
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const exit = () => {
    save();
    if (window.history.length > 1) navigate(-1);
    else navigate(detailPath(type, id, video ? videoId : undefined));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const el = videoRef.current;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          seekBy(-settings.seekStep);
          break;
        case 'ArrowRight':
          seekBy(settings.seekStep);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (el) setVol(el.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (el) setVol(el.volume - 0.1);
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'm':
          if (el) el.muted = !el.muted;
          break;
        case 'g':
          setSubDelay((d) => +(d - 0.25).toFixed(2));
          break;
        case 'h':
          setSubDelay((d) => +(d + 0.25).toFixed(2));
          break;
        case 'Escape':
          if (!document.fullscreenElement) setMenu(null);
          break;
        default:
          return;
      }
      poke();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekBy, toggleFullscreen, poke, settings.seekStep]);

  // ---- Next episode ----
  const playNext = useCallback(async () => {
    if (!next) return;
    save();
    setLoadingNext(true);
    // Play a matching stream straight away; fall back to the episode's stream list.
    const match = await findNextStream(addons, type, next.id, stream).catch(() => null);
    if (match) navigate(playerPath(match, type, id, next.id), { replace: true });
    else navigate(detailPath(type, id, next.id), { replace: true });
  }, [next, stream, addons, type, id, navigate, save]);

  // Reset per-video state when moving to another episode.
  useEffect(() => {
    resumed.current = false;
    autoplayed.current = false;
    // Until the new episode loads, the old position must not count (it would read as "ended").
    setTime(0);
    setDuration(0);
    setBuffered(0);
    window.clearTimeout(seekTimer.current);
    conversionSeq.current++;
    pendingSeek.current = null;
    conversionRef.current = null;
    setConversion(null);
    probeRef.current = null;
    tracksRef.current = [];
    wantedAudio.current = null;
    setDirectAudio(null);
    setFileTracks([]);
    setLoadingNext(false);
    setUpNextDismissed(false);
    setSelectedSub(null);
    userPickedSub.current = false;
    setSubDelay(0);
  }, [params.stream]);

  // ---- Casting hand-off ----
  const castPrev = useRef({ casting: false, state: castApi.status.state });
  useEffect(() => {
    const el = videoRef.current;
    const prev = castPrev.current;
    const { state, currentTime, duration: d, error: castError, deviceName } = castApi.status;
    if (casting && !prev.casting) {
      el?.pause();
    } else if (!casting && prev.casting) {
      // Pick up locally where the TV left off.
      if (el && currentTime > 0) seekLocal(currentTime);
      if (state === 'error') toast(castError ?? 'Casting stopped because of an error', 'error');
      else if (state === 'ended') {
        if (d > 0) updateProgress(metaPreview, videoId, d, d);
        toast(`Finished playing on ${deviceName ?? 'your TV'}`);
      } else if (prev.state !== 'connecting') toast('Casting stopped');
    }
    castPrev.current = { casting, state };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casting, castApi.status.state]);

  // Leaving the player ends the cast session so it never runs without controls.
  useEffect(
    () => () => {
      if (castRef.current.casting) castRef.current.control('stop');
    },
    [],
  );

  const onEnded = () => {
    save();
    if (loadedStream.current !== params.stream) return;
    if (next && settings.autoplayNext && !upNextDismissed && !autoplayed.current) {
      autoplayed.current = true;
      playNext();
    }
  };

  const shownTime = casting ? castApi.status.currentTime : time;
  const shownDuration = casting ? castApi.status.duration || duration : duration;
  const shownPlaying = casting ? castApi.status.state === 'playing' : playing;

  const subtitleLines = useMemo(
    () => (casting ? [] : activeCues(cues, time - subDelay)),
    [casting, cues, time, subDelay],
  );
  const remaining = shownDuration - shownTime;
  // With known end credits, offer the next episode as soon as the credits roll.
  // Timings from a different cut of the episode can fall outside this stream; ignore them then.
  const creditsStart =
    segments.outro && segments.outro.start > shownDuration * 0.5 && segments.outro.start < shownDuration - 5
      ? segments.outro.start
      : null;
  const showUpNext =
    !!next &&
    !upNextDismissed &&
    shownDuration > 0 &&
    remaining > 0 &&
    (creditsStart !== null ? shownTime >= creditsStart : remaining < UP_NEXT_SECONDS);

  // Autoplay: 10 s into the credits when they're known, otherwise at the very end. It follows the
  // video's position, so pausing pauses the countdown. Off while casting so it can't pull playback
  // away from the TV.
  const autoplayOn = !!next && settings.autoplayNext && !upNextDismissed && !casting;
  const autoplayAt =
    creditsStart !== null ? Math.min(creditsStart + AUTOPLAY_COUNTDOWN, shownDuration) : shownDuration;
  const countdown =
    autoplayOn && showUpNext && autoplayAt - shownTime <= AUTOPLAY_COUNTDOWN
      ? Math.max(0, Math.ceil(autoplayAt - shownTime))
      : null;

  useEffect(() => {
    if (!autoplayOn || autoplayed.current || shownDuration <= 0) return;
    if (loadedStream.current !== params.stream) return;
    if (shownTime >= autoplayAt - 0.3) {
      autoplayed.current = true;
      playNext();
    }
  }, [autoplayOn, autoplayAt, shownTime, shownDuration, playNext, params.stream]);

  const seekTo = (t: number) => {
    if (casting) castApi.control('seek', t);
    else seekLocal(t);
  };
  // The last second of a segment doesn't count, so the button disappears as the skip lands.
  const within = (seg?: Segment) => !!seg && shownTime >= seg.start && shownTime < seg.end - 1;
  const skippable: { kind: 'intro' | 'recap' | 'credits'; seg: Segment } | null = within(segments.recap)
    ? { kind: 'recap', seg: segments.recap! }
    : within(segments.intro)
      ? { kind: 'intro', seg: segments.intro! }
      : // On a finale there's no next episode, but credits can still hide a post-credits scene.
        !next && within(segments.outro) && segments.outro!.end < shownDuration - 5
        ? { kind: 'credits', seg: segments.outro! }
        : null;
  const skipLabel = skippable ? { intro: 'Skip Intro', recap: 'Skip Recap', credits: 'Skip Credits' }[skippable.kind] : '';

  useEffect(() => {
    if (!settings.autoSkipIntro || !skippable || skippable.kind === 'credits') return;
    const key = `${videoId}:${skippable.kind}`;
    if (autoSkipped.current.has(key)) return; // only once, so seeking back into the intro is respected
    autoSkipped.current.add(key);
    seekTo(skippable.seg.end);
    toast(skippable.kind === 'intro' ? 'Skipped intro' : 'Skipped recap');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skippable?.kind, skippable?.seg.end, settings.autoSkipIntro, videoId]);

  // S skips the current intro/recap/credits.
  useEffect(() => {
    if (!skippable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 's' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      seekTo(skippable.seg.end);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skippable?.seg.end, casting]);

  const subsByLang = useMemo(() => {
    const groups = new Map<string, SubTrack[]>();
    for (const t of subTracks) {
      const name = t.origin === 'Local file' ? 'Local file' : languageName(t.lang);
      groups.set(name, [...(groups.get(name) ?? []), t]);
    }
    const preferred = settings.subtitleLanguage ? languageName(settings.subtitleLanguage) : '';
    return [...groups.entries()].sort(([a], [b]) => (a === preferred ? -1 : b === preferred ? 1 : a.localeCompare(b)));
  }, [subTracks, settings.subtitleLanguage]);
  const [subLang, setSubLang] = useState<string | null>(null);
  const currentSub = subTracks.find((t) => t.key === selectedSub);
  const activeLang = subLang ?? (currentSub ? languageName(currentSub.lang) : subsByLang[0]?.[0] ?? null);

  const title = meta?.name ?? metaPreview.name;
  const subtitle = video ? `${episodeLabel(video)} · ${videoTitle(video)}` : '';

  const startCast = async (deviceId?: string) => {
    if (!src) return;
    setMenu(null);
    const track = subTracks.find((t) => t.key === selectedSub);
    const err = await castApi.start(
      {
        url: directSrc.current ?? src,
        filename: stream?.behaviorHints?.filename,
        title,
        subtitle: subtitle || undefined,
        poster: meta?.poster ?? meta?.background,
        startTime: position(),
        subtitleVtt: cues.length ? cuesToVtt(cues, subDelay) : undefined,
        subtitleLang: track?.lang,
      },
      deviceId,
    );
    // Desktop casting reports failures through its status (handled above).
    if (err && castApi.kind === 'chrome') toast(err, 'error');
  };
  const showCastButton =
    !!src && (castApi.kind === 'native' || ((castApi.kind === 'chrome' || castApi.kind === 'airplay') && castApi.available));

  // ---- YouTube streams are played through the embed player ----
  if (kind === 'youtube' && stream?.ytId) {
    return (
      <div className="player youtube">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${stream.ytId}?autoplay=1&rel=0`}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
        <div className="player-top visible">
          <button className="icon-btn glass round" onClick={exit} aria-label="Back">
            <Icon name="back" />
          </button>
          <div className="player-title">
            <div className="strong">{title}</div>
          </div>
        </div>
      </div>
    );
  }

  const pct = shownDuration ? (shownTime / shownDuration) * 100 : 0;
  const bufPct = !casting && duration ? (buffered / duration) * 100 : 0;
  const castBackdrop = meta?.background ?? meta?.poster;

  return (
    <div
      ref={containerRef}
      className={`player ${controlsVisible || !shownPlaying || casting ? 'show-controls' : 'hide-cursor'}`}
      onMouseMove={poke}
      onTouchStart={poke}
    >
      <video
        ref={videoRef}
        className="player-video"
        playsInline
        onClick={() => (menu ? setMenu(null) : togglePlay())}
        onDoubleClick={toggleFullscreen}
        onPlay={() => {
          setPlaying(true);
          poke();
        }}
        onPause={() => {
          setPlaying(false);
          setControlsVisible(true);
          save();
        }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => !holdForCheck.current && setBuffering(false)}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={(e) => !conversionRef.current && setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setTime((conversionRef.current?.start ?? 0) + e.currentTarget.currentTime)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          if (b.length) setBuffered((conversionRef.current?.start ?? 0) + b.end(b.length - 1));
        }}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
        onEnded={onEnded}
        onError={() => {
          if (hlsRef.current) return;
          if (conversionRef.current) return setError('MoviePlex couldn’t convert this stream’s audio.');
          setError(
            stream?.behaviorHints?.notWebReady
              ? 'This stream is not web-ready (its format or codec cannot be played in the browser).'
              : 'The video could not be played. The format may be unsupported by your browser or the link has expired.',
          );
        }}
      />

      {subtitleLines.length > 0 && (
        <div
          className="subtitle-layer"
          style={{
            fontSize: `calc(clamp(16px, 2.6vw, 34px) * ${settings.subtitleSize / 100})`,
            color: settings.subtitleColor,
          }}
        >
          {subtitleLines.map((c, i) => (
            <span
              key={i}
              style={{ background: `rgba(0,0,0,${settings.subtitleBackground})` }}
              dangerouslySetInnerHTML={{ __html: c.text.replace(/\n/g, '<br/>') }}
            />
          ))}
        </div>
      )}

      {buffering && !error && !casting && (
        <div className="player-center">
          <Spinner size={56} />
          {kind === 'torrent' && <p className="muted small">Connecting to peers…</p>}
        </div>
      )}

      {error && (
        <div className="player-error">
          <Icon name="info" size={36} />
          <h3>Can't play this stream</h3>
          <p>{error}</p>
          <div className="row-gap">
            <button className="btn" onClick={exit}>
              Choose another stream
            </button>
            {stream?.url && (
              <>
                <button
                  className="btn glass"
                  onClick={async () => toast((await copyText(stream.url!)) ? 'Stream URL copied' : 'Copy failed')}
                >
                  <Icon name="copy" /> Copy URL
                </button>
                <a className="btn glass" href={stream.url} target="_blank" rel="noreferrer">
                  <Icon name="external" /> Open externally
                </a>
              </>
            )}
          </div>
        </div>
      )}

      {casting && (
        <div className="cast-overlay">
          {castBackdrop && <div className="cast-backdrop" style={{ backgroundImage: `url("${castBackdrop}")` }} />}
          <div className="cast-card">
            <Icon name="cast" size={44} />
            <div className="muted">{castApi.status.state === 'connecting' ? 'Connecting to' : 'Casting to'}</div>
            <div className="cast-device">{castApi.status.deviceName ?? 'your TV'}</div>
            {(castApi.status.state === 'connecting' || castApi.status.state === 'buffering') && <Spinner size={28} />}
            <button className="btn glass" onClick={() => castApi.control('stop')}>
              Stop casting
            </button>
          </div>
        </div>
      )}

      <div className="player-top">
        <button className="icon-btn glass round" onClick={exit} aria-label="Back">
          <Icon name="back" />
        </button>
        <div className="player-title">
          <div className="strong">{title}</div>
          {subtitle && <div className="muted small">{subtitle}</div>}
        </div>
        {stream?.name && <div className="player-source">{stream.name.split('\n')[0]}</div>}
      </div>

      {settings.skipButtons && skippable && !error && (
        <button
          className="skip-btn"
          onClick={(e) => {
            e.stopPropagation();
            seekTo(skippable.seg.end);
          }}
        >
          {skipLabel} <Icon name="next" size={18} />
        </button>
      )}

      {(showUpNext || loadingNext) && next && (
        <div className="up-next">
          {next.thumbnail && <img src={next.thumbnail} alt="" />}
          <div className="up-next-body">
            <div className="muted small">
              {loadingNext
                ? 'Starting next episode…'
                : countdown !== null
                  ? `Next episode in ${countdown}s`
                  : `Up next · ${episodeLabel(next)}`}
            </div>
            <div className="strong">
              {countdown !== null || loadingNext ? `${episodeLabel(next)} · ` : ''}
              {videoTitle(next)}
            </div>
            <div className="row-gap">
              <button className="btn primary small" onClick={playNext} disabled={loadingNext}>
                {loadingNext ? <Spinner size={14} /> : <Icon name="play" size={16} />} Play now
              </button>
              {!loadingNext && (
                <button className="btn glass small" onClick={() => setUpNextDismissed(true)}>
                  {autoplayOn ? 'Cancel' : 'Dismiss'}
                </button>
              )}
            </div>
            {countdown !== null && !loadingNext && (
              <div className="up-next-countdown">
                <div style={{ width: `${Math.min(100, (1 - (autoplayAt - shownTime) / AUTOPLAY_COUNTDOWN) * 100)}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="player-bottom" onClick={(e) => e.stopPropagation()}>
        <div
          className="seek"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = clamp(e.clientX - r.left, 0, r.width);
            setHover({ x, t: (x / r.width) * shownDuration });
          }}
          onMouseLeave={() => setHover(null)}
        >
          <div className="seek-track">
            <div className="seek-buffer" style={{ width: `${bufPct}%` }} />
            {shownDuration > 0 &&
              [segments.recap, segments.intro, segments.outro].map(
                (seg, i) =>
                  seg && (
                    <div
                      key={i}
                      className="seek-segment"
                      style={{
                        left: `${(seg.start / shownDuration) * 100}%`,
                        width: `${((seg.end - seg.start) / shownDuration) * 100}%`,
                      }}
                    />
                  ),
              )}
            <div className="seek-fill" style={{ width: `${pct}%` }} />
          </div>
          <input
            type="range"
            min={0}
            max={shownDuration || 0}
            step={0.1}
            value={shownTime}
            onChange={(e) => {
              const t = +e.target.value;
              if (casting) return castApi.control('seek', t);
              seekLocal(t);
              setTime(t);
            }}
            aria-label="Seek"
          />
          {hover && shownDuration > 0 && (
            <div className="seek-tooltip" style={{ left: hover.x }}>
              {formatTime(hover.t)}
            </div>
          )}
        </div>

        <div className="controls">
          <button className="icon-btn ghost" onClick={togglePlay} aria-label={shownPlaying ? 'Pause' : 'Play'}>
            <Icon name={shownPlaying ? 'pause' : 'play'} size={26} />
          </button>
          <button className="icon-btn ghost" onClick={() => seekBy(-settings.seekStep)} title={`Back ${settings.seekStep}s`}>
            <Icon name="rewind" />
          </button>
          <button className="icon-btn ghost" onClick={() => seekBy(settings.seekStep)} title={`Forward ${settings.seekStep}s`}>
            <Icon name="forward" />
          </button>
          {next && (
            <button className="icon-btn ghost" onClick={playNext} title={`Next: ${episodeLabel(next)}`}>
              <Icon name="next" />
            </button>
          )}
          <div className="volume">
            <button
              className="icon-btn ghost"
              onClick={() => videoRef.current && (videoRef.current.muted = !videoRef.current.muted)}
              aria-label="Mute"
            >
              <Icon name={muted || volume === 0 ? 'mute' : 'volume'} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => setVol(+e.target.value)}
              aria-label="Volume"
            />
          </div>
          <span className="time">
            {formatTime(shownTime)} <span className="muted">/ {formatTime(shownDuration)}</span>
          </span>

          <div className="spacer" />

          {showCastButton && (
            <div className="menu-anchor">
              <button
                className={`icon-btn ghost ${casting ? 'active' : ''}`}
                title={castApi.kind === 'airplay' ? 'AirPlay' : casting ? `Casting to ${castApi.status.deviceName ?? 'TV'}` : 'Cast'}
                onClick={() => {
                  if (castApi.kind === 'native') {
                    if (menu !== 'cast') castApi.refreshDevices();
                    setMenu(menu === 'cast' ? null : 'cast');
                  } else if (casting) castApi.control('stop');
                  else startCast();
                }}
              >
                <Icon name="cast" />
              </button>
              {menu === 'cast' && (
                <div className="player-menu cast-menu">
                  <div className="menu-title">Cast to</div>
                  {castApi.devices.map((d) => {
                    const current = casting && castApi.status.deviceName === d.name;
                    return (
                      <button
                        key={d.id}
                        className={`menu-item ${current ? 'active' : ''}`}
                        onClick={() => (current ? setMenu(null) : startCast(d.id))}
                      >
                        <span>
                          {d.name}
                          {d.model && <span className="muted small"> · {d.model}</span>}
                        </span>
                      </button>
                    );
                  })}
                  {castApi.devices.length === 0 && (
                    <div className="menu-item muted cast-searching">
                      <Spinner size={14} /> Looking for Chromecast devices…
                    </div>
                  )}
                  {casting && (
                    <button className="menu-item danger-item" onClick={() => castApi.control('stop')}>
                      Stop casting
                    </button>
                  )}
                  <div className="menu-hint muted small">Devices must be on the same Wi-Fi network.</div>
                </div>
              )}
            </div>
          )}

          <div className="menu-anchor">
            <button
              className={`icon-btn ghost ${selectedSub ? 'active' : ''}`}
              onClick={() => setMenu(menu === 'subtitles' ? null : 'subtitles')}
              title="Subtitles"
            >
              <Icon name="subtitles" />
            </button>
            {menu === 'subtitles' && (
              <div className="player-menu subs-menu">
                <div className="subs-cols">
                  <div className="subs-col">
                    <div className="menu-title">Language</div>
                    <button
                      className={`menu-item ${!selectedSub ? 'active' : ''}`}
                      onClick={() => {
                        userPickedSub.current = true;
                        setSelectedSub(null);
                        setSubLang(null);
                      }}
                    >
                      Off
                    </button>
                    {subsByLang.map(([lang, list]) => (
                      <button
                        key={lang}
                        className={`menu-item ${activeLang === lang && selectedSub ? 'active' : ''} ${activeLang === lang ? 'focus' : ''}`}
                        onClick={() => {
                          setSubLang(lang);
                          if (!list.some((t) => t.key === selectedSub)) {
                            userPickedSub.current = true;
                            setSelectedSub(list[0].key);
                          }
                        }}
                      >
                        {lang} <span className="muted">{list.length}</span>
                      </button>
                    ))}
                    {subsLoading && (
                      <div className="menu-item muted">
                        <Spinner size={14} /> Loading…
                      </div>
                    )}
                    {!subsLoading && subTracks.length === 0 && <div className="menu-item muted">No subtitles found</div>}
                    <label className="menu-item file">
                      Load from file…
                      <input
                        type="file"
                        accept=".srt,.vtt"
                        onChange={(e) => e.target.files?.[0] && loadLocalSubtitle(e.target.files[0])}
                      />
                    </label>
                  </div>
                  {activeLang && subsByLang.find(([l]) => l === activeLang) && (
                    <div className="subs-col">
                      <div className="menu-title">Variant</div>
                      {subsByLang
                        .find(([l]) => l === activeLang)![1]
                        .map((t, i) => (
                          <button
                            key={t.key}
                            className={`menu-item ${selectedSub === t.key ? 'active' : ''}`}
                            onClick={() => {
                              userPickedSub.current = true;
                              setSelectedSub(t.key);
                            }}
                          >
                            {t.origin} #{i + 1}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <div className="menu-footer">
                  <span>Delay</span>
                  <button className="icon-btn ghost small" onClick={() => setSubDelay((d) => +(d - 0.25).toFixed(2))}>
                    −
                  </button>
                  <span className="mono">{subDelay.toFixed(2)}s</span>
                  <button className="icon-btn ghost small" onClick={() => setSubDelay((d) => +(d + 0.25).toFixed(2))}>
                    +
                  </button>
                  <span className="spacer" />
                  <span>Size</span>
                  <button
                    className="icon-btn ghost small"
                    onClick={() => settings.set('subtitleSize', clamp(settings.subtitleSize - 10, 50, 250))}
                  >
                    −
                  </button>
                  <span className="mono">{settings.subtitleSize}%</span>
                  <button
                    className="icon-btn ghost small"
                    onClick={() => settings.set('subtitleSize', clamp(settings.subtitleSize + 10, 50, 250))}
                  >
                    +
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="menu-anchor">
            <button
              className="icon-btn ghost"
              onClick={() => setMenu(menu === 'audio' ? null : 'audio')}
              title="Audio"
              aria-label="Audio"
            >
              <Icon name="audio" />
            </button>
            {menu === 'audio' && (
              <div className="player-menu">
                <div className="menu-title">Audio</div>
                {fileTracks.length > 0 ? (
                  fileTracks.map((t) => {
                    const current = conversion
                      ? conversion.audio === t.index
                      : t.index === (directAudio ?? fileDefault(fileTracks).index);
                    return (
                      <button
                        key={t.index}
                        className={`menu-item ${current ? 'active' : ''}`}
                        onClick={() => {
                          setMenu(null);
                          if (current) return;
                          // Playable tracks switch in the player itself; Dolby/DTS play through conversion.
                          if (!t.supported || !NATIVE_AUDIO_TRACKS || !directSrc.current) startConversion(t.index, position());
                          else if (conversion) {
                            wantedAudio.current = t.index;
                            playDirectAt(directSrc.current, position());
                          } else if (!selectDirectTrack(t.index)) startConversion(t.index, position());
                        }}
                      >
                        <span className="track-label">
                          {t.title || (t.language ? languageName(t.language) : `Track ${t.index + 1}`)}
                          <span className="muted small">
                            {[t.title && t.language ? languageName(t.language) : '', codecName(t.codec), channelName(t.channels)]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                      </button>
                    );
                  })
                ) : audioTracks.length > 0 ? (
                  audioTracks.map((t) => (
                    <button
                      key={t.id}
                      className={`menu-item ${audioTrack === t.id ? 'active' : ''}`}
                      onClick={() => {
                        if (hlsRef.current) hlsRef.current.audioTrack = t.id;
                        setAudioTrack(t.id);
                        setMenu(null);
                      }}
                    >
                      {t.name}
                    </button>
                  ))
                ) : checkingAudio ? (
                  <div className="menu-item muted">
                    <Spinner size={14} /> Checking audio tracks…
                  </div>
                ) : (
                  <div className="menu-item muted">This stream has one audio track</div>
                )}
              </div>
            )}
          </div>

          {levels.length > 1 && (
            <div className="menu-anchor">
              <button className="icon-btn ghost" onClick={() => setMenu(menu === 'quality' ? null : 'quality')} title="Quality">
                <Icon name="quality" />
              </button>
              {menu === 'quality' && (
                <div className="player-menu">
                  <div className="menu-title">Quality</div>
                  {[{ id: -1, name: 'Auto' }, ...levels].map((l) => (
                    <button
                      key={l.id}
                      className={`menu-item ${level === l.id ? 'active' : ''}`}
                      onClick={() => {
                        if (hlsRef.current) hlsRef.current.currentLevel = l.id;
                        setLevel(l.id);
                      }}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="menu-anchor">
            <button className="icon-btn ghost" onClick={() => setMenu(menu === 'speed' ? null : 'speed')} title="Playback speed">
              <Icon name="speed" />
            </button>
            {menu === 'speed' && (
              <div className="player-menu">
                <div className="menu-title">Speed</div>
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={`menu-item ${speed === s ? 'active' : ''}`}
                    onClick={() => {
                      if (videoRef.current) videoRef.current.playbackRate = s;
                      setSpeed(s);
                    }}
                  >
                    {s === 1 ? 'Normal' : `${s}×`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="icon-btn ghost" onClick={toggleFullscreen} aria-label="Fullscreen">
            <Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} />
          </button>
        </div>
      </div>
    </div>
  );
}
