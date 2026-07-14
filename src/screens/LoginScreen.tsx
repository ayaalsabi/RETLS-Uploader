import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { RootStackParamList } from "../navigation/types";
import { sendPushTokenToServer } from "../utils/pushNotifications";

type Nav = NativeStackNavigationProp<RootStackParamList, "Login">;

// TODO: point this at your real host (192.168.1.19 is only reachable on your LAN/emulator).
// Use 10.0.2.2 instead of 192.168.1.19 for Android emulator, or your machine's LAN IP for a physical device.
const API_BASE = "http://192.168.1.19/api";

// TODO: swap this for your actual logo asset path.
const LOGO_SOURCE = require("../assets/RATLSLOGO-removebg-preview.png");

type LoginResponse = {
  role: string;
  token?: string;
  [key: string]: any;
};

export default function LoginScreenGlass() {
  const navigation = useNavigation<Nav>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  async function handleLogin() {
    setError(null);

    if (!email.trim() || !password) {
      setError("Please enter email and password");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/User/authenticate`, {
        method: "POST",
        headers: {
          Accept: "text/plain",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      if (!response.ok) {
        setError("Wrong email or password");
        setLoading(false);
        return;
      }

      const data: LoginResponse = await response.json();
      const role = (data.role || "").toLowerCase();

      if (role !== "user" && role !== "admin") {
        setError("Unknown role returned by server");
        setLoading(false);
        return;
      }

      await AsyncStorage.setItem("role", role);
      await AsyncStorage.setItem("token", data.token ?? "");
      await sendPushTokenToServer(data.token);

      if (role === "user") {
        navigation.reset({ index: 0, routes: [{ name: "UploaderHome" }] });
      } else if (role === "admin") {
        navigation.reset({ index: 0, routes: [{ name: "ViewerInbox" }] });
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("Could not reach server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <LinearGradient
      colors={["#382f54", "#203652", "#14513b"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}
    >
      {/* Soft floating blobs for extra depth behind the glass */}
      <View style={styles.blobA} />
      <View style={styles.blobB} />
      <View style={styles.blobC} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.container}>
            <Image
              source={LOGO_SOURCE}
              style={styles.logo}
              resizeMode="cover"
            />

            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>
              Sign in to send or review shared files.
            </Text>

            <BlurView intensity={35} tint="light" style={styles.card}>
              <Text style={styles.fieldLabel}>Email</Text>
              <View
                style={[
                  styles.inputWrapper,
                  emailFocused && styles.inputWrapperFocused,
                ]}
              >
                <Feather
                  name="mail"
                  size={17}
                  color="#000000"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="you@example.com"
                  placeholderTextColor="rgba(0, 0, 0, 0.6)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                />
              </View>

              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>
                Password
              </Text>
              <View
                style={[
                  styles.inputWrapper,
                  passwordFocused && styles.inputWrapperFocused,
                ]}
              >
                <Feather
                  name="lock"
                  size={17}
                  color="#000000"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor="rgba(0, 0, 0, 0.6)"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather
                    name={showPassword ? "eye-off" : "eye"}
                    size={17}
                    color="rgba(0, 0, 0, 0.8)"
                  />
                </TouchableOpacity>
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <Feather name="alert-circle" size={14} color="#DC2626" />
                  <Text style={styles.error}>{error}</Text>
                </View>
              ) : null}
              <TouchableOpacity
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.85}
                style={loading && styles.primaryButtonDisabled}
              >
                <LinearGradient
                  colors={["#382f54", "#203652", "#14513b"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.primaryButton}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Text style={styles.primaryButtonText}>Log in</Text>
                      <Feather name="arrow-right" size={18} color="#FFFFFF" />
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </BlurView>

            <Text style={styles.footerText}>
              Trouble signing in? Contact your administrator.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  blobA: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(255,255,255,0.15)",
    top: -60,
    left: -60,
  },
  blobB: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(255,255,255,0.12)",
    bottom: 60,
    right: -50,
  },
  blobC: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255,255,255,0.1)",
    bottom: -30,
    left: 40,
  },
  logo: {
    width: 300,
    height: 100,
    alignSelf: "center",
    marginBottom: 20,
    backgroundColor: "#ffffff",
    borderRadius: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(255,255,255,0.85)",
    marginBottom: 28,
  },
  card: {
    borderRadius: 24,
    padding: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(255, 255, 255)",
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgb(0, 0, 0)",
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 50,
    backgroundColor: "#F9FAFB",
  },
  inputWrapperFocused: {
    borderColor: "#A78BFA",
    backgroundColor: "#FFFFFF",
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: "#000000",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 16,
    gap: 6,
  },
  error: {
    color: "#DC2626",
    fontSize: 13,
    flexShrink: 1,
  },
  primaryButton: {
    flexDirection: "row",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 22,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  footerText: {
    textAlign: "center",
    fontSize: 12,
    color: "rgba(255,255,255,0.75)",
    marginTop: 24,
  },
});
