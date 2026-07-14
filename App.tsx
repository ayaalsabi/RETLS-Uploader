import React, { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AppNavigator from "./src/navigation/AppNavigator";
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [isReady, setIsReady] = useState(true);
  const navigationRef = useRef();

  useEffect(() => {
    const receivedListener = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log("Foreground:", notification);
      },
    );

    const responseListener =
      Notifications.addNotificationResponseReceivedListener((response) => {
        handleNavigation(response);
      });

    return () => {
      receivedListener.remove();
      responseListener.remove();
    };
  }, []);

  // ✅ Handle notification when app is CLOSED
  useEffect(() => {
    if (!isReady) return;

    const checkInitialNotification = async () => {
      const response = await Notifications.getLastNotificationResponseAsync();

      if (response) {
        handleNavigation(response);
      }
    };

    checkInitialNotification();
  }, [isReady]);

  const handleNavigation = (response) => {
    const data = response?.notification?.request?.content?.data;

    if (!data) return;

    try {
      const parsed = JSON.parse(data.url);
      const { pageName } = parsed;

      let screenName = null;

      switch (pageName) {
        case "New Review":
          screenName = "Login";
          break;

        default:
          return;
      }

      if (navigationRef.current && screenName) {
        navigationRef.current.navigate(screenName);
      }
    } catch (e) {
      console.log("Notification parse error:", e);
    }
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppNavigator />
    </SafeAreaProvider>
  );
}
