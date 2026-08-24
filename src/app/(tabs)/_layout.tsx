import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';

import { registerPushToken } from '@/lib/notifications';

export default function TabsLayout() {
  // File this device's push address once signed in. No-op on web/Expo Go;
  // becomes real with the development build.
  useEffect(() => {
    registerPushToken();
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#0b0c0e', borderTopColor: '#1a1d22' },
        tabBarActiveTintColor: '#ffffff',
        tabBarInactiveTintColor: '#6d7076',
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
