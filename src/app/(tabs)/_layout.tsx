import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPlayer } from '@/components/mini-player';
import { SHOP_TAB_LIVE } from '@/lib/shop';
import { tapFeedback } from '@/lib/haptics';
import { registerPushToken } from '@/lib/notifications';
import { configurePayments } from '@/lib/payments';
import { useAuth } from '@/providers/auth-provider';
import { installPushNavigation } from '@/lib/push-navigation';

/** Icons for the pill; shop renders as the detached teaser circle. */
const TAB_ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  index: { on: 'home', off: 'home-outline' },
  chat: { on: 'chatbubbles', off: 'chatbubbles-outline' },
  fanmail: { on: 'mail', off: 'mail-outline' },
};

// Just the slice of the navigation tab-bar props this dock actually uses.
type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (event: {
      type: 'tabPress';
      target?: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
};

/** Floating dock: a pill of tabs + the dimmed S333XSHOP circle beside it. */
function FloatingTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.dock, { bottom: insets.bottom + 10 }]} pointerEvents="box-none">
      <View style={styles.pill}>
        {state.routes
          .filter((route) => route.name !== 'shop')
          .map((route) => {
            const routeIndex = state.routes.findIndex((r) => r.key === route.key);
            const focused = state.index === routeIndex;
            const icons = TAB_ICONS[route.name] ?? TAB_ICONS.index;
            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={focused ? { selected: true } : {}}
                style={[styles.tab, focused && styles.tabOn]}
                onPress={() => {
                  tapFeedback();
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) {
                    navigation.navigate(route.name);
                  }
                }}>
                <Ionicons
                  name={focused ? icons.on : icons.off}
                  size={22}
                  color={focused ? '#ffffff' : '#6d7278'}
                />
              </Pressable>
            );
          })}
      </View>
      {/* S333XSHOP — live bubble, or the dimmed teaser on review day. */}
      {!SHOP_TAB_LIVE ? (
        <View style={styles.circle}>
          <Ionicons name="bag-outline" size={16} color="#4a4f57" />
          <Text style={[styles.circleLabel, { color: '#4a4f57' }]}>S333XSHOP</Text>
        </View>
      ) : (() => {
        const shopIndex = state.routes.findIndex((r) => r.name === 'shop');
        const shopRoute = state.routes[shopIndex];
        const focused = state.index === shopIndex;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            style={[styles.circle, focused && styles.circleOn]}
            onPress={() => {
              tapFeedback();
              const event = navigation.emit({
                type: 'tabPress',
                target: shopRoute.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate('shop');
              }
            }}>
            <Ionicons name={focused ? 'bag' : 'bag-outline'} size={16} color={focused ? '#ffffff' : '#8d97a0'} />
            <Text style={[styles.circleLabel, focused && styles.circleLabelOn]}>S333XSHOP</Text>
          </Pressable>
        );
      })()}
    </View>
  );
}

export default function TabsLayout() {
  const router = useRouter();
  const { session } = useAuth();

  // Billing identity follows the signed-in account.
  useEffect(() => {
    if (session?.user.id) configurePayments(session.user.id);
  }, [session?.user.id]);

  // File this device's push address once signed in, and route notification
  // taps to the exact post/chat/drop they announce.
  useEffect(() => {
    registerPushToken();
    let cleanup: (() => void) | undefined;
    installPushNavigation(router).then((fn) => {
      cleanup = fn;
    });
    return () => cleanup?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="chat" />
        <Tabs.Screen name="fanmail" />
        <Tabs.Screen name="shop" />
      </Tabs>
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(21, 24, 29, 0.97)',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2e34',
    paddingVertical: 7,
    paddingHorizontal: 10,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 26,
    borderRadius: 999,
  },
  tabOn: { backgroundColor: 'rgba(255, 255, 255, 0.11)' },
  circle: {
    minWidth: 74,
    height: 54,
    paddingHorizontal: 10,
    gap: 3,
    borderRadius: 27,
    backgroundColor: 'rgba(21, 24, 29, 0.97)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2e34',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  circleOn: { backgroundColor: 'rgba(255,255,255,0.11)' },
  circleLabel: {
    color: '#8d97a0',
    fontSize: 6.5,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  circleLabelOn: { color: '#ffffff' },
});
