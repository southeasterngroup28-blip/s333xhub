import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { fetchEffectiveBackgroundUrl } from '@/lib/backgrounds';
import { useAuth } from '@/providers/auth-provider';

// One fetch shared across screens (refreshed at most once a minute).
let cached: { userId: string; url: string | null; at: number } | null = null;

/** Call after the background is changed in Settings so screens pick it up right away. */
export function invalidateBackgroundCache() {
  cached = null;
}

/** The user's MySpace-style background, rendered edge-to-edge behind a screen. */
export function AppBackground() {
  const { session } = useAuth();
  const [url, setUrl] = useState<string | null>(
    cached && cached.userId === session?.user.id ? cached.url : null
  );

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    if (cached && cached.userId === userId && Date.now() - cached.at < 60_000) {
      setUrl(cached.url);
      return;
    }
    let cancelled = false;
    fetchEffectiveBackgroundUrl(userId)
      .then((fresh) => {
        cached = { userId, url: fresh, at: Date.now() };
        if (!cancelled) setUrl(fresh);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  if (!url) return null;

  return (
    <>
      <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
      <View style={styles.scrim} />
    </>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(6, 7, 9, 0.32)',
  },
});
