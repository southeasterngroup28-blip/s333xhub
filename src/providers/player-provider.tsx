import {
  createAudioPlayer,
  setAudioModeAsync,
  useAudioPlayerStatus,
  type AudioStatus,
} from 'expo-audio';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { errorFeedback } from '@/lib/haptics';

export type Track = {
  postId: string;
  title: string;
  url: string;
  artworkUrl?: string;
};

// Two contexts from one provider: controls change only when the TRACK
// changes, status ticks twice a second. Screens that just need "is a track
// loaded" or "play this" subscribe to controls and stay still while the
// clock runs; only the players themselves watch the status stream.
type PlayerControlsValue = {
  /** The track currently loaded (playing or paused), if any. */
  current: Track | null;
  playTrack: (track: Track) => void;
  toggle: () => void;
  seekTo: (seconds: number) => void;
  /** Pause without unloading (voice notes / videos borrow the speakers). */
  pause: () => void;
  /** Full stop: silence + clear the loaded track (sign-out, etc.). */
  stop: () => void;
};

type PlayerStatusValue = {
  status: AudioStatus | null;
  /** True from tap-to-play until audio actually starts — show "playing" UI. */
  starting: boolean;
  /** Starting has taken over 600ms — time for a spinner, not a glyph flip. */
  startingSlow: boolean;
  /** The loaded track could not play — the play button retries it. */
  failed: boolean;
};

const PlayerControlsContext = createContext<PlayerControlsValue>({
  current: null,
  playTrack: () => {},
  toggle: () => {},
  seekTo: () => {},
  pause: () => {},
  stop: () => {},
});

const PlayerStatusContext = createContext<PlayerStatusValue>({
  status: null,
  starting: false,
  startingSlow: false,
  failed: false,
});

export function usePlayerControls() {
  return useContext(PlayerControlsContext);
}

export function usePlayerStatus() {
  return useContext(PlayerStatusContext);
}

export function PlayerProvider({ children }: PropsWithChildren) {
  // One player for the whole app: starting a new track replaces the old one.
  const player = useMemo(() => createAudioPlayer(), []);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<Track | null>(null);
  const [starting, setStarting] = useState(false);
  const [startingSlow, setStartingSlow] = useState(false);
  const [failed, setFailed] = useState(false);

  // `toggle` must not depend on the status stream (that would churn the
  // controls context twice a second), so the one status-only fact it needs
  // lives in a ref, refreshed by the hook above.
  const didJustFinishRef = useRef(false);
  useEffect(() => {
    didJustFinishRef.current = !!status?.didJustFinish;
  }, [status?.didJustFinish]);

  const failedRef = useRef(false);
  const markFailed = useCallback(() => {
    // Buzz once, on the false-to-true transition only.
    if (!failedRef.current) errorFeedback();
    failedRef.current = true;
    setFailed(true);
    // A failed track is no longer "starting" — without this, a fast
    // status error leaves the discs spinning (or on the pause glyph)
    // while the sub line already says "Tap to retry".
    setStarting(false);
  }, []);
  const clearFailed = useCallback(() => {
    failedRef.current = false;
    setFailed(false);
  }, []);

  // The moment real audio flows, the optimistic phase ends — and any
  // earlier failure is forgiven. If nothing flows within 8s (dead URL,
  // no network), stop pretending and surface the failure.
  useEffect(() => {
    if (status?.playing) {
      if (starting) setStarting(false);
      clearFailed();
    }
  }, [starting, status?.playing, clearFailed]);
  useEffect(() => {
    if (!starting) return;
    const timer = setTimeout(() => {
      setStarting(false);
      if (!player.playing) markFailed();
    }, 8_000);
    return () => clearTimeout(timer);
    // `current` re-keys the deadline: switching tracks mid-load (starting
    // already true) must give the NEW track its own fresh 8 seconds, not
    // inherit the tail of the old one and get flagged as failed.
  }, [starting, current, player, markFailed]);

  // A playback error from the native side fails the current track too.
  useEffect(() => {
    if (status?.error != null && current) markFailed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.error]);

  // The first 600ms of a load keeps the instant glyph flip; past that the
  // discs swap to a spinner (startingSlow) so a slow network reads honest.
  useEffect(() => {
    if (!starting) {
      setStartingSlow(false);
      return;
    }
    const timer = setTimeout(() => setStartingSlow(true), 600);
    return () => clearTimeout(timer);
  }, [starting]);

  useEffect(() => {
    // playsInSilentMode: iPhones with the mute switch on would otherwise play nothing.
    // shouldPlayInBackground: keeps audio alive when the app is backgrounded
    // (needs a real build — has no effect in the browser).
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {});

    return () => {
      player.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Announce the current track to the lock screen / control center once
  // playback has actually started (announcing before load gets dropped).
  // Also required on Android for background playback beyond ~3 minutes.
  useEffect(() => {
    if (!current || !status?.playing) return;
    const anyPlayer = player as unknown as Record<string, unknown>;
    // TEMP DEBUG: report what the native side actually exposes.
    try {
      (anyPlayer.setActiveForLockScreen as (
        active: boolean,
        metadata?: { title?: string; artist?: string; artworkUrl?: string },
        options?: { showSeekBackward?: boolean; showSeekForward?: boolean }
      ) => void)(
        true,
        { title: current.title, artist: 'S333XHUB', artworkUrl: current.artworkUrl },
        { showSeekBackward: true, showSeekForward: true }
      );
    } catch {
      // No lock screen on this platform (web) — fine.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.postId, status?.playing]);

  const playTrack = useCallback(
    (track: Track) => {
      setCurrent(track);
      setStarting(true);
      clearFailed();
      player.replace({ uri: track.url });
      player.play();
    },
    [player, clearFailed]
  );

  const toggle = useCallback(() => {
    if (!current) return;
    if (failedRef.current) {
      // Retry: reload the same track from scratch.
      player.replace({ uri: current.url });
      player.play();
      setStarting(true);
      clearFailed();
      return;
    }
    // Reads the player synchronously so this callback never depends on the
    // status stream — the controls context stays still while the clock runs.
    if (player.playing) {
      player.pause();
      return;
    }
    // A finished track replays from the top - without this, play after
    // the end is a dead button (the playhead never rewinds itself).
    const dur = player.duration ?? 0;
    if (didJustFinishRef.current || (dur > 0 && (player.currentTime ?? 0) >= dur - 0.3)) {
      player.seekTo(0);
    }
    player.play();
  }, [current, player, clearFailed]);

  const seekTo = useCallback(
    (seconds: number) => {
      player.seekTo(seconds);
    },
    [player]
  );

  const pause = useCallback(() => {
    try {
      player.pause();
    } catch {}
  }, [player]);

  const stop = useCallback(() => {
    try {
      player.pause();
    } catch {}
    setCurrent(null);
    setStarting(false);
    clearFailed();
  }, [player, clearFailed]);

  const controls = useMemo(
    () => ({ current, playTrack, toggle, seekTo, pause, stop }),
    [current, playTrack, toggle, seekTo, pause, stop]
  );

  const statusValue = useMemo(
    () => ({ status, starting, startingSlow, failed }),
    [status, starting, startingSlow, failed]
  );

  return (
    <PlayerControlsContext.Provider value={controls}>
      <PlayerStatusContext.Provider value={statusValue}>{children}</PlayerStatusContext.Provider>
    </PlayerControlsContext.Provider>
  );
}
