import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Platform } from "react-native";

export const getExpoPushToken = async () => {
  if (!Device.isDevice) {
    Alert.alert("Use real device");
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    Alert.alert("Permission denied");
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  return tokenData.data;
};

export const sendPushTokenToServer = async (userToken) => {
  try {
    const expoPushToken = await getExpoPushToken();

    if (!expoPushToken || !userToken) return;

    console.log("Sending push token:", expoPushToken);

    await fetch("http://192.168.1.19/api/Notification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ pushToken: expoPushToken }),
    });

    await AsyncStorage.setItem("pushTokenSent", "true");
  } catch (e) {
    console.log("Push token send error:", e);
  }
};