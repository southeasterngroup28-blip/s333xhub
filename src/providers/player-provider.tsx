import {
  createAudioPlayer,
  setAudioModeAsync,
  useAudioPlayerStatus,
  type AudioStatus,
} from 'expo-audio';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

export type Track = {
  postId: string;
  title: string;
  url: string;
  artworkUrl?: string;
};

type PlayerContextValue = {
  /** The track currently loaded (playing or paused), if any. */
  current: Track | null;
  status: AudioStatus | null;
  /** True from tap-to-play until audio actually starts — show "playing" UI. */
  starting: boolean;
  playTrack: (track: Track) => void;
  toggle: () => void;
  seekTo: (seconds: number) => void;
};

const PlayerContext = createContext<PlayerContextValue>({
  current: null,
  status: null,
  starting: false,
  playTrack: () => {},
  toggle: () => {},
  seekTo: () => {},
});

export function usePlayer() {
  return useContext(PlayerContext);
}

export function PlayerProvider({ children }: PropsWithChildren) {
  // One player for the whole app: starting a new track replaces the old one.
  const player = useMemo(() => createAudioPlayer(), []);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<Track | null>(null);
  const [starting, setStarting] = useState(false);

  // The moment real audio flows, the optimistic phase ends. If nothing
  // flows within 12s (dead URL, no network), stop pretending.
  useEffect(() => {
    if (starting && status?.playing) setStarting(false);
  }, [starting, status?.playing]);
  useEffect(() => {
    if (!starting) return;
    const timer = setTimeout(() => setStarting(false), 12_000);
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

  function playTrack(track: Track) {
    setCurrent(track);
    setStarting(true);
    player.replace({ uri: track.url });
    player.play();
  }

  function toggle() {
    if (!current) return;
    if (status?.playing) {
      player.pause();
      return;
    }
    // A finished track replays from the top - without this, play after
    // the end is a dead button (the playhead never rewinds itself).
    const dur = status?.duration ?? 0;
    if (status?.didJustFinish || (dur > 0 && (status?.currentTime ?? 0) >= dur - 0.3)) {
      player.seekTo(0);
    }
    player.play();
  }

  function seekTo(seconds: number) {
    player.seekTo(seconds);
  }

  return (
    <PlayerContext.Provider value={{ current, status, starting, playTrack, toggle, seekTo }}>
      {children}
    </PlayerContext.Provider>
  );
}
