import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import MciIcon from "@/components/MciIcon";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { useColors } from "@/hooks/useColors";

export default function TabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 58 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Overview",
          tabBarIcon: ({ color }) => (
            <MciIcon name="view-dashboard" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="food-logger"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="calendar"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="scratch-tracker"
        options={{
          title: "Habits",
          tabBarIcon: ({ color }) => (
            <MciIcon name="hand-peace" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="export"
        options={{
          title: "Export",
          tabBarIcon: ({ color }) => (
            <MciIcon name="database-export" size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
