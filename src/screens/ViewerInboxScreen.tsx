import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import FileCard from "../components/FileCard";
import { RootStackParamList } from "../navigation/types";
import { SafeAreaView } from "react-native-safe-area-context";

type Nav = NativeStackNavigationProp<RootStackParamList, "ViewerInbox">;

// TODO: keep this in sync with the API_BASE used in LoginScreen / UploaderHomeScreen.
const API_BASE = "http://192.168.1.19/api";

/**
 * Shape of a submission as returned by GET /Submissions/getallSubmissions.
 */
type Submission = {
  id: number;
  uploadedByUserId: number;
  reviewedByUserId: number;
  title: string;
  description: string;
  filePath: string;
  status: string;
  createdBy: string;
  createdOn: string;
  lastModifiedOn: string;
  isDisabled: boolean;
};

type SubmissionsResponse = {
  currentPage: number;
  totalItems: number;
  result: Submission[];
};

/**
 * FileCard expects a DesignFile shape (file.name, file.kind, file.sentAt),
 * but the API returns different field names (title, filePath, status).
 * This adapts one into the other so the cards render correctly.
 */
function toDesignFile(submission: Submission) {
  const filePath = submission.filePath ?? "";
  const isPdf = filePath.toLowerCase().endsWith(".pdf");

  return {
    id: submission.id,
    name: submission.title ?? "Untitled",
    kind: isPdf ? "pdf" : "image",
    sentAt: submission.status ?? "Unknown",
    status: submission.status === "Approved" ? "received" : "pending",
    commentCount: 0,
  } as any;
}

export default function ViewerInboxScreen() {
  const navigation = useNavigation<Nav>();
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [submissionsError, setSubmissionsError] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Change password modal state
  const [changePasswordVisible, setChangePasswordVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(
    null,
  );

  const loadSubmissions = useCallback(async () => {
    setLoadingSubmissions(true);
    setSubmissionsError(null);
    try {
      const token = await AsyncStorage.getItem("token");

      const response = await fetch(
        `${API_BASE}/Submissions/getallSubmissions`,
        {
          method: "GET",
          headers: {
            Accept: "text/plain",
            Authorization: `Bearer ${token ?? ""}`,
          },
        },
      );

      if (!response.ok) {
        setSubmissionsError(`Could not load files (${response.status})`);
        return;
      }

      const data: SubmissionsResponse = await response.json();
      setSubmissions(Array.isArray(data.result) ? data.result : []);
    } catch (err) {
      console.error("Load submissions error:", err);
      setSubmissionsError("Could not reach server. Check your connection.");
    } finally {
      setLoadingSubmissions(false);
    }
  }, []);

  // Refresh every time this screen comes into focus, not just on first mount.
  useFocusEffect(
    useCallback(() => {
      loadSubmissions();
    }, [loadSubmissions]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadSubmissions();
    } finally {
      setRefreshing(false);
    }
  }

  function confirmDelete(submission: Submission) {
    Alert.alert(
      "Delete file",
      `Delete "${submission.title}"? This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => handleDelete(submission.id),
        },
      ],
    );
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      const token = await AsyncStorage.getItem("token");

      const response = await fetch(`${API_BASE}/Submissions/${id}`, {
        method: "DELETE",
        headers: {
          Accept: "*/*",
          Authorization: `Bearer ${token ?? ""}`,
        },
      });

      if (!response.ok) {
        Alert.alert("Error", `Could not delete file (${response.status})`);
        return;
      }

      setSubmissions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error("Delete submission error:", err);
      Alert.alert("Error", "Could not reach server. Check your connection.");
    } finally {
      setDeletingId(null);
    }
  }

  function openChangePassword() {
    setChangePasswordError(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setChangePasswordVisible(true);
  }

  function closeChangePassword() {
    if (changingPassword) return;
    setChangePasswordVisible(false);
  }

  async function handleChangePassword() {
    setChangePasswordError(null);

    if (!currentPassword) {
      setChangePasswordError("Enter your current password");
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setChangePasswordError("New password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordError("Passwords do not match");
      return;
    }

    setChangingPassword(true);
    try {
      const token = await AsyncStorage.getItem("token");

      const response = await fetch(`${API_BASE}/User/updatePassword`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "*/*",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 400) {
          setChangePasswordError("Current password is incorrect");
        } else {
          setChangePasswordError(
            `Could not change password (${response.status})`,
          );
        }
        return;
      }

      setChangePasswordVisible(false);
      Alert.alert("Success", "Your password has been changed.");
    } catch (err) {
      console.error("Change password error:", err);
      setChangePasswordError("Could not reach server. Check your connection.");
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <LinearGradient
      colors={["#382f54", "#203652", "#14513b"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}
    >
      <View style={styles.blobA} />
      <View style={styles.blobB} />
      <View style={styles.blobC} />

      <SafeAreaView style={styles.container}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#FFFFFF"
            />
          }
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Incoming files</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.headerIconButton}
                onPress={openChangePassword}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="lock" size={17} color="#FFFFFF" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.headerIconButton}
                onPress={() => navigation.navigate("Login")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="log-out" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>

          <BlurView intensity={35} tint="light" style={styles.card}>
            {loadingSubmissions ? (
              <ActivityIndicator
                color="#7C3AED"
                style={{ marginVertical: 8 }}
              />
            ) : submissionsError ? (
              <Text style={styles.errorText}>{submissionsError}</Text>
            ) : submissions.length === 0 ? (
              <Text style={styles.emptyText}>No files yet.</Text>
            ) : (
              submissions.map((file, index) => (
                <View
                  key={file.id}
                  style={[
                    styles.row,
                    index === submissions.length - 1 && { marginBottom: 0 },
                  ]}
                >
                  <View style={styles.cardWrap}>
                    <FileCard
                      file={toDesignFile(file)}
                      onPress={() =>
                        navigation.navigate("FileDetails", {
                          fileId: file.id,
                        })
                      }
                    />
                  </View>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => confirmDelete(file)}
                    disabled={deletingId === file.id}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {deletingId === file.id ? (
                      <ActivityIndicator size="small" color="#DC2626" />
                    ) : (
                      <Feather name="trash-2" size={18} color="#DC2626" />
                    )}
                  </TouchableOpacity>
                </View>
              ))
            )}
          </BlurView>
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={changePasswordVisible}
        animationType="slide"
        transparent
        onRequestClose={closeChangePassword}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={closeChangePassword}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <View style={styles.modalTitleRow}>
                <Text style={styles.modalTitle}>Change password</Text>
                <TouchableOpacity
                  onPress={closeChangePassword}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="x" size={20} color="#6B7280" />
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Current password</Text>
              <TextInput
                style={styles.input}
                placeholder="Current password"
                placeholderTextColor="#9CA3AF"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
                autoCapitalize="none"
              />

              <Text style={styles.fieldLabel}>New password</Text>
              <TextInput
                style={styles.input}
                placeholder="New password"
                placeholderTextColor="#9CA3AF"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoCapitalize="none"
              />

              <Text style={styles.fieldLabel}>Confirm new password</Text>
              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                placeholderTextColor="#9CA3AF"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoCapitalize="none"
              />

              {changePasswordError ? (
                <Text style={styles.errorText}>{changePasswordError}</Text>
              ) : null}

              <TouchableOpacity
                onPress={handleChangePassword}
                disabled={changingPassword}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={["#382f54", "#203652", "#14513b"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[
                    styles.primaryButton,
                    changingPassword && styles.primaryButtonDisabled,
                  ]}
                >
                  {changingPassword ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      Update password
                    </Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  card: {
    borderRadius: 24,
    padding: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  errorText: {
    color: "#DC2626",
    fontSize: 13,
  },
  emptyText: {
    fontSize: 13,
    color: "#9CA3AF",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  cardWrap: {
    flex: 1,
  },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEF2F2",
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6B7280",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },
  primaryButton: {
    flexDirection: "row",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E5E7EB",
    alignSelf: "center",
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 12,
  },
  modalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
