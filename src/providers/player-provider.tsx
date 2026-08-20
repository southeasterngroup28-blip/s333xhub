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
};

type PlayerContextValue = {
  /** The track currently loaded (playing or paused), if any. */
  current: Track | null;
  status: AudioStatus | null;
  playTrack: (track: Track) => void;
  toggle: () => void;
  seekTo: (seconds: number) => void;
};

const PlayerContext = createContext<PlayerContextValue>({
  current: null,
  status: null,
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

  function playTrack(track: Track) {
    setCurrent(track);
    player.replace({ uri: track.url });
    player.play();
  }

  function toggle() {
    if (!current) return;
    if (status?.playing) {
      player.pause();
    } else {
      player.play();
    }
  }

  function seekTo(seconds: number) {
    player.seekTo(seconds);
  }

  return (
    <PlayerContext.Provider value={{ current, status, playTrack, toggle, seekTo }}>
      {children}
    </PlayerContext.Provider>
  );
}
