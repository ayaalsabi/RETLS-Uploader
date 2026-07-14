import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import FileCard from "../components/FileCard";
import { RootStackParamList } from "../navigation/types";
import { SafeAreaView } from "react-native-safe-area-context";

type Nav = NativeStackNavigationProp<RootStackParamList, "UploaderHome">;

// TODO: keep this in sync with the API_BASE used in LoginScreen.
const API_BASE = "http://192.168.1.19/api";

type PickedFile = {
  uri: string;
  name: string;
  mimeType?: string;
};

/**
 * Shape of a submission as returned by GET /Submissions/getallSubmissions.
 */
type Submission = {
  id: number;
  title: string;
  description: string;
  filePath: string;
  status: string;
  reviewedByUserId: number;
  uploadedByUserId: number;
};

type SubmissionsResponse = {
  currentPage: number;
  totalItems: number;
  result: Submission[];
};

/**
 * Shape of a user as returned by GET /User.
 * NOTE: adjust field names below (name/userName/email) to match whatever
 * your API actually returns — swap them in getAdminDisplayName if needed.
 */
type ApiUser = {
  id: number;
  name?: string;
  userName?: string;
  fullName?: string;
  email?: string;
  role?: string;
  nameEn?: string;
};

function isAdmin(user: ApiUser) {
  return (user.role ?? "").toLowerCase() === "admin";
}

function getAdminDisplayName(user: ApiUser) {
  return user.nameEn;
}

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

export default function UploaderHomeScreen() {
  const navigation = useNavigation<Nav>();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [submissionsError, setSubmissionsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Admin/reviewer dropdown state
  const [admins, setAdmins] = useState<ApiUser[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  const [adminsError, setAdminsError] = useState<string | null>(null);
  const [selectedAdmin, setSelectedAdmin] = useState<ApiUser | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

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

  const loadAdmins = useCallback(async () => {
    setLoadingAdmins(true);
    setAdminsError(null);
    try {
      const token = await AsyncStorage.getItem("token");

      const response = await fetch(`${API_BASE}/User`, {
        method: "GET",
        headers: {
          Accept: "text/plain",
          Authorization: `Bearer ${token ?? ""}`,
        },
      });

      if (!response.ok) {
        setAdminsError(`Could not load reviewers (${response.status})`);
        return;
      }

      const data = await response.json();
      // Handle either a raw array or a { result: [...] } wrapper, same as Submissions.
      const list: ApiUser[] = Array.isArray(data)
        ? data
        : Array.isArray(data.result)
          ? data.result
          : [];
      const adminList = list.filter(isAdmin);
      setAdmins(adminList);
      setSelectedAdmin((current) => current ?? adminList[0] ?? null);
    } catch (err) {
      console.error("Load admins error:", err);
      setAdminsError("Could not reach server. Check your connection.");
    } finally {
      setLoadingAdmins(false);
    }
  }, []);

  // Refresh every time this screen comes into focus (e.g. after an upload
  // and navigating back), not just on first mount.
  useFocusEffect(
    useCallback(() => {
      loadSubmissions();
    }, [loadSubmissions]),
  );

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([loadSubmissions(), loadAdmins()]);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleChooseFile() {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.length) {
      return;
    }

    const asset = result.assets[0];
    setPickedFile({
      uri: asset.uri,
      name: asset.name ?? "file",
      mimeType: asset.mimeType ?? "application/octet-stream",
    });
  }

  async function handleUpload() {
    setError(null);

    if (!pickedFile) {
      setError("Choose a file first");
      return;
    }
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!selectedAdmin) {
      setError("Choose a reviewer first");
      return;
    }

    setUploading(true);
    try {
      const token = await AsyncStorage.getItem("token");

      const formData = new FormData();
      formData.append("file", {
        uri: pickedFile.uri,
        name: pickedFile.name,
        type: pickedFile.mimeType,
      } as any);

      const query = new URLSearchParams({
        title: title.trim(),
        description: description.trim(),
        reviewedByUserId: String(selectedAdmin.id),
      }).toString();

      const response = await fetch(`${API_BASE}/Submissions?${query}`, {
        method: "POST",
        headers: {
          Accept: "text/plain",
          Authorization: `Bearer ${token ?? ""}`,
          // Don't set Content-Type manually — fetch adds the multipart
          // boundary automatically when the body is a FormData instance.
        },
        body: formData,
      });

      if (!response.ok) {
        setError(`Upload failed (${response.status})`);
        setUploading(false);
        return;
      }

      Alert.alert("Sent", "Your file was submitted.");
      setTitle("");
      setDescription("");
      setPickedFile(null);
      setSelectedAdmin(null);
      loadSubmissions();
    } catch (err) {
      console.error("Upload error:", err);
      setError("Could not reach server. Check your connection.");
    } finally {
      setUploading(false);
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
          keyboardShouldPersistTaps="handled"
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
            <Text style={styles.headerTitle}>Send a file</Text>
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
            <TouchableOpacity
              style={styles.dropZone}
              onPress={handleChooseFile}
            >
              <View style={styles.dropIconBadge}>
                <Feather name="upload" size={20} color="#7C3AED" />
              </View>
              <Text style={styles.dropTitle}>
                {pickedFile ? pickedFile.name : "Choose a file to send"}
              </Text>
              <Text style={styles.dropSubtitle}>PDF, image, or document</Text>
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput
              style={styles.input}
              placeholder="Title"
              placeholderTextColor="#9CA3AF"
              value={title}
              onChangeText={setTitle}
            />

            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Optional details"
              placeholderTextColor="#9CA3AF"
              value={description}
              onChangeText={setDescription}
              multiline
            />

            <Text style={styles.fieldLabel}>Reviewer</Text>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() => {
                if (admins.length === 0 && !loadingAdmins) {
                  loadAdmins();
                }
                setPickerVisible(true);
              }}
            >
              <Text
                style={[
                  styles.dropdownTriggerText,
                  !selectedAdmin && { color: "#9CA3AF" },
                ]}
              >
                {selectedAdmin
                  ? getAdminDisplayName(selectedAdmin)
                  : "Choose a reviewer"}
              </Text>
              <Feather name="chevron-down" size={18} color="#9CA3AF" />
            </TouchableOpacity>
            {loadingAdmins ? (
              <ActivityIndicator color="#7C3AED" style={{ marginBottom: 12 }} />
            ) : adminsError ? (
              <Text style={styles.error}>{adminsError}</Text>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              onPress={handleUpload}
              disabled={uploading}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={["#382f54", "#203652", "#14513b"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                  styles.primaryButton,
                  uploading && styles.primaryButtonDisabled,
                ]}
              >
                {uploading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Text style={styles.primaryButtonText}>Upload</Text>
                    <Feather name="arrow-up" size={17} color="#FFFFFF" />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </BlurView>

          <Text style={styles.sectionLabel}>Sent so far</Text>

          <BlurView intensity={35} tint="light" style={styles.card}>
            {loadingSubmissions ? (
              <ActivityIndicator
                color="#7C3AED"
                style={{ marginVertical: 8 }}
              />
            ) : submissionsError ? (
              <Text style={styles.error}>{submissionsError}</Text>
            ) : submissions.length === 0 ? (
              <Text style={styles.emptyText}>No files sent yet.</Text>
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
                        navigation.navigate("FileDetail", { fileId: file.id })
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
        visible={pickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setPickerVisible(false)}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Choose a reviewer</Text>

            {loadingAdmins ? (
              <ActivityIndicator
                color="#7C3AED"
                style={{ marginVertical: 20 }}
              />
            ) : adminsError ? (
              <Text style={styles.error}>{adminsError}</Text>
            ) : admins.length === 0 ? (
              <Text style={styles.emptyText}>No admins found.</Text>
            ) : (
              <FlatList
                data={admins}
                keyExtractor={(item) => String(item.id)}
                style={{ maxHeight: 320 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalRow}
                    onPress={() => {
                      setSelectedAdmin(item);
                      setPickerVisible(false);
                    }}
                  >
                    <Text style={styles.modalRowText}>
                      {getAdminDisplayName(item)}
                    </Text>
                    {selectedAdmin?.id === item.id ? (
                      <Feather name="check" size={18} color="#7C3AED" />
                    ) : null}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>

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
                <Text style={styles.error}>{changePasswordError}</Text>
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
    marginBottom: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  dropZone: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#C4B5FD",
    borderRadius: 18,
    paddingVertical: 26,
    alignItems: "center",
    marginBottom: 18,
    backgroundColor: "#FAF5FF",
  },
  dropIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#F3E8FF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  dropTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
    color: "#2E1065",
    textAlign: "center",
    paddingHorizontal: 16,
  },
  dropSubtitle: {
    fontSize: 12,
    color: "#8B7BA8",
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
  textArea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 10,
    backgroundColor: "#F9FAFB",
  },
  dropdownTriggerText: {
    fontSize: 14,
    color: "#111827",
  },
  error: {
    color: "#DC2626",
    fontSize: 13,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 13,
    color: "#9CA3AF",
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
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 10,
    marginLeft: 4,
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
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  modalRowText: {
    fontSize: 14,
    color: "#111827",
  },
});
