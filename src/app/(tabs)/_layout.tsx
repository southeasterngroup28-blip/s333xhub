import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

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
      <Tabs.Screen
        name="shop"
        options={{
          // Teaser tab: always dimmed, never navigates.
          tabBarIcon: ({ size }) => <Ionicons name="bag-outline" size={size} color="#3a3d43" />,
          tabBarLabel: () => (
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#3a3d43', fontSize: 10, fontWeight: '600' }}>S333XSHOP</Text>
              <Text style={{ color: '#3a3d43', fontSize: 8 }}>coming soon</Text>
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
  );
}
