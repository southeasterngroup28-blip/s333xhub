import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { MiniPlayer } from '@/components/mini-player';
import { registerPushToken } from '@/lib/notifications';

export default function TabsLayout() {
  // File this device's push address once signed in. No-op on web/Expo Go;
  // becomes real with the development build.
  useEffect(() => {
    registerPushToken();
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: '#0d0f13',
            borderTopWidth: 0,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            shadowColor: '#000',
            shadowOpacity: 0.5,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: -6 },
            elevation: 14,
            paddingTop: 6,
          },
          tabBarLabelStyle: {
            fontSize: 9.5,
            fontWeight: '700',
            letterSpacing: 1.3,
            textTransform: 'uppercase',
          },
          tabBarActiveTintColor: '#ffffff',
          tabBarInactiveTintColor: '#565c63',
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Feed',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'home' : 'home-outline'} size={size - 2} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            title: 'Chat',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'chatbubbles' : 'chatbubbles-outline'}
                size={size - 2}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="fanmail"
          options={{
            title: 'Fan Mail',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'mail' : 'mail-outline'} size={size - 2} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="shop"
          options={{
            // Teaser tab: always dimmed, never navigates.
            tabBarIcon: ({ size }) => (
              <Ionicons name="bag-outline" size={size - 2} color="#33363c" />
            ),
            tabBarLabel: () => (
              <View style={{ alignItems: 'center' }}>
                <Text
                  style={{
                    color: '#33363c',
                    fontSize: 9.5,
                    fontWeight: '700',
                    letterSpacing: 1.3,
                  }}>
                  S333XSHOP
                </Text>
                <Text style={{ color: '#33363c', fontSize: 7.5, letterSpacing: 0.5 }}>
                  COMING SOON
                </Text>
              </View>
            ),
          }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
            },
          }}
        />
      </Tabs>
      <MiniPlayer />
    </View>
  );
}
