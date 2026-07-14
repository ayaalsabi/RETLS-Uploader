import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
  Alert,
  RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import * as signalR from "@microsoft/signalr";
import { RootStackParamList } from "../navigation/types";
import { SafeAreaView } from "react-native-safe-area-context";

type Nav = NativeStackNavigationProp<RootStackParamList, "FileDetail">;
type DetailRoute = RouteProp<RootStackParamList, "FileDetail">;

// TODO: keep this in sync with the API_BASE used in LoginScreen / UploaderHomeScreen.
const API_BASE = "http://192.168.1.19/api";
// Files are served from the server root by filename, e.g. http://192.168.1.19/<filename>
const SERVER_ROOT = "http://192.168.1.19";
// ChatHub is mapped on the server root, not under /api — same pattern as AmanWay's hub.
// TODO: confirm the exact path your Program.cs / Startup.cs uses for app.MapHub<ChatHub>(...)
const HUB_URL = `${SERVER_ROOT}/Hub/chatHub`;

/**
 * Shape of a message as returned by GET /Reviews/messages/{submissionId}.
 */
type Message = {
  id: number;
  submissionId: number;
  senderId: number;
  senderName: string;
  senderRole: string;
  receiverId: number;
  receiverName: string;
  receiverRole: string;
  content: string;
  isRead: boolean;
  createdOn: string;
  newFile?: string;
};

/**
 * Shape of a submission as returned by GET /Submissions/{id}.
 */
type Submission = {
  id: number;
  title: string;
  description: string;
  filePath: string;
  status: string;
  reviewedByUserId: number;
  uploadedByUserId: number;
  createdBy: string;
  createdOn: string;
  lastModifiedOn: string;
  isDisabled: boolean;
};

type PickedFile = {
  uri: string;
  name: string;
  mimeType?: string;
};

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fileNameFromPath(path: string) {
  const decoded = decodeURIComponent(path);
  const parts = decoded.split("/");
  return parts[parts.length - 1] || decoded;
}

/**
 * Builds a file URL using just the filename, e.g.
 * "http://192.168.1.19/Aya Al-Sab'i CV.pdf" (URL-encoded).
 * Ignores the folder part of filePath (e.g. "/Documents/") since files are
 * served directly from the server root by filename.
 */
function buildFileUrl(filePath: string) {
  const normalized = filePath.startsWith("/") ? filePath : `/${filePath}`;

  return `${SERVER_ROOT}${encodeURI(normalized)}`;
}

/**
 * Pulls the user id out of the JWT's "sub" (or nameidentifier) claim so we
 * can tell "my" messages apart from messages sent to me. Login only stores
 * the role/token, not a separate "userId" key, so this reads it straight
 * out of the token instead of a stored value that's never actually set.
 */
function decodeJwtUserId(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;

    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );
    const json = decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    const claims = JSON.parse(json);
    const id =
      claims.sub ??
      claims[
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"
      ];

    return id ? Number(id) : null;
  } catch (err) {
    console.error("Decode token error:", err);
    return null;
  }
}

export default function FileDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const { fileId } = route.params;

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  // The current logged-in user, used to tell "my" messages apart from
  // messages sent to me.
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [role, setRole] = useState("user");

  // Admin approve/reject state
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [attachedFile, setAttachedFile] = useState<PickedFile | null>(null);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Auto-scroll-to-bottom for the comments list.
  const listRef = useRef<FlatList<Message>>(null);
  const scrollToBottom = useCallback((animated: boolean = true) => {
    // rAF so it runs after the list has actually laid out the new item.
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  // --- SignalR live connection state ---
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const connectionRef = useRef<signalR.HubConnection | null>(null);
  // Mirrors so the handlers registered once inside connectionRef don't close
  // over stale values (same pattern as AmanWay's isDriverActiveRef).
  const fileIdRef = useRef(fileId);
  fileIdRef.current = fileId;

  const loadMessages = useCallback(async () => {
    setLoadingMessages(true);
    setMessagesError(null);
    try {
      const token = await AsyncStorage.getItem("token");

      const response = await fetch(`${API_BASE}/Reviews/messages/${fileId}`, {
        method: "GET",
        headers: {
          Accept: "text/plain",
          Authorization: `Bearer ${token ?? ""}`,
        },
      });

      if (!response.ok) {
        setMessagesError(`Could not load comments (${response.status})`);
        return;
      }

      const data: Message[] = await response.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Load messages error:", err);
      setMessagesError("Could not reach server. Check your connection.");
    } finally {
      setLoadingMessages(false);
    }
  }, [fileId]);

  const loadSubmission = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await AsyncStorage.getItem("token");

      const response = await fetch(`${API_BASE}/Submissions/${fileId}`, {
        method: "GET",
        headers: {
          Accept: "text/plain",
          Authorization: `Bearer ${token ?? ""}`,
        },
      });

      if (!response.ok) {
        setError(`Could not load file (${response.status})`);
        return;
      }

      const data: Submission = await response.json();
      setSubmission(data);
    } catch (err) {
      console.error("Load submission error:", err);
      setError("Could not reach server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentUser() {
      const token = await AsyncStorage.getItem("token");
      const storedRole = await AsyncStorage.getItem("role");
      if (isMounted) {
        setCurrentUserId(token ? decodeJwtUserId(token) : null);
        setRole(storedRole ?? "user");
      }
    }

    loadCurrentUser();
    loadSubmission();
    loadMessages();
    return () => {
      isMounted = false;
    };
  }, [fileId, loadMessages, loadSubmission]);

  // Jump to the bottom whenever the message list changes (new comment sent,
  // received live, or loaded/refreshed from the server).
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom(true);
    }
  }, [messages, scrollToBottom]);

  // --- SignalR: connect once per screen instance, join this submission's
  // group, and tear down cleanly on unmount. Listener registration is kept
  // separate from connection.start() so handlers are attached before any
  // event can arrive. ---
  useEffect(() => {
    let cancelled = false;

    async function connect() {
      const token = await AsyncStorage.getItem("token");

      const connection = new signalR.HubConnectionBuilder()
        .withUrl(HUB_URL, {
          accessTokenFactory: () => token ?? "",
        })
        .withAutomaticReconnect()
        .build();

      // Register listeners BEFORE start() — avoids the race where the hub
      // could fire before we're listening.
      connection.on("ReceiveMessage", (raw: any) => {
        const submissionId = raw?.submissionId ?? raw?.SubmissionId;
        if (Number(submissionId) !== Number(fileIdRef.current)) return;
        // Re-fetch from the server instead of hand-mapping the payload —
        // sidesteps PascalCase/camelCase mismatches entirely.
        loadMessages();
      });

      connection.on("SubmissionStatusChanged", (raw: any) => {
        const id = raw?.id ?? raw?.Id;
        if (Number(id) !== Number(fileIdRef.current)) return;
        loadSubmission();
      });

      // Per-user channel from NotifyUser(ReceiverId, ...). Backend sends
      // this alongside the group broadcast, keyed off "Type": "NewReview".
      // Fallback path — if the group broadcast doesn't land, this still
      // catches it and refreshes from the server.
      connection.on("ReceiveNotification", (raw: any) => {
        const type = raw?.Type ?? raw?.type;
        const submissionId = raw?.SubmissionId ?? raw?.submissionId;

        if (type !== "NewReview") return;
        if (Number(submissionId) !== Number(fileIdRef.current)) return;

        loadMessages();
      });

      connection.onreconnecting(() => {
        if (!cancelled) setConnectionStatus("connecting");
      });

      connection.onreconnected(async () => {
        if (cancelled) return;
        setConnectionStatus("connected");
        // Groups don't survive a reconnect — rejoin.
        try {
          await connection.invoke("JoinSubmission", Number(fileIdRef.current));
        } catch (err) {
          console.error("Rejoin submission group error:", err);
        }
      });

      connection.onclose(() => {
        if (!cancelled) setConnectionStatus("disconnected");
      });

      connectionRef.current = connection;

      try {
        await connection.start();
        if (cancelled) return;
        await connection.invoke("JoinSubmission", Number(fileId));
        setConnectionStatus("connected");
      } catch (err) {
        console.error("SignalR connect error:", err);
        if (!cancelled) setConnectionStatus("disconnected");
      }
    }

    connect();

    return () => {
      cancelled = true;
      const connection = connectionRef.current;
      if (connection) {
        connection
          .invoke("LeaveSubmission", Number(fileIdRef.current))
          .catch(() => {})
          .finally(() => {
            connection.stop();
          });
        connectionRef.current = null;
      }
    };
  }, [fileId, loadMessages, loadSubmission]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([loadSubmission(), loadMessages()]);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleOpenFile() {
    if (!submission?.filePath) return;

    setOpening(true);

    try {
      const url = buildFileUrl(submission.filePath);

      console.log("Opening:", url);

      await Linking.openURL(url);
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Unable to open file.");
    } finally {
      setOpening(false);
    }
  }

  async function handleAttachFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.length) {
      return;
    }

    const asset = result.assets[0];
    setAttachedFile({
      uri: asset.uri,
      name: asset.name ?? "file",
      mimeType: asset.mimeType ?? "application/octet-stream",
    });
  }

  async function updateStatus(status: "Approved" | "Rejected", reason: string) {
    setStatusError(null);
    setUpdatingStatus(true);
    try {
      const token = await AsyncStorage.getItem("token");
      const response = await fetch(
        `${API_BASE}/Submissions/update-status/${fileId}`,
        {
          method: "PUT",
          headers: {
            Accept: "*/*",
            "Content-Type": "application/json",
            Authorization: `Bearer ${token ?? ""}`,
          },
          body: JSON.stringify({
            status,
            rejectionReason: reason,
          }),
        },
      );

      if (!response.ok) {
        setStatusError(`Could not update status (${response.status})`);
        return;
      }

      // Reflect the new status immediately instead of refetching, so the
      // approve/reject section hides right away. Other connected clients
      // get the same update via the SubmissionStatusChanged broadcast.
      setSubmission((prev) => (prev ? { ...prev, status } : prev));
      setShowRejectInput(false);
      setRejectionReason("");
    } catch (err) {
      console.error("Update status error:", err);
      setStatusError("Could not reach server. Check your connection.");
    } finally {
      setUpdatingStatus(false);
    }
  }

  function handleApprove() {
    updateStatus("Approved", "");
  }

  function handleRejectConfirm() {
    if (!rejectionReason.trim()) {
      setStatusError("Enter a reason for rejecting this file.");
      return;
    }
    updateStatus("Rejected", rejectionReason.trim());
  }

  async function handleSend() {
    // A comment always needs text — attaching a file is never enough on
    // its own, so this checks trimmed text first regardless of attachment.
    if (!text.trim()) {
      Alert.alert(
        "Add a comment",
        "Write a message before sending — an attachment alone can't be sent.",
      );
      return;
    }
    if (!submission) return;

    const content = text.trim();
    setSending(true);
    try {
      const token = await AsyncStorage.getItem("token");
      const senderId = currentUserId ?? 0;

      // /Reviews takes multipart/form-data (not JSON) so a file can ride
      // along with the comment. Don't set Content-Type manually — fetch
      // adds the multipart boundary automatically for a FormData body.
      const formData = new FormData();
      formData.append("submissionId", String(fileId));
      formData.append("senderId", String(senderId));
      // The person who uploaded this submission — the reviewer's replies
      // go back to them.
      formData.append("receiverId", String(submission.reviewedByUserId));
      formData.append("content", content);

      if (attachedFile) {
        formData.append("file", {
          uri: attachedFile.uri,
          name: attachedFile.name,
          type: attachedFile.mimeType,
        } as any);
      }

      const response = await fetch(`${API_BASE}/Reviews`, {
        method: "POST",
        headers: {
          Accept: "text/plain",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: formData,
      });
      console.log("formdata", formData);
      if (!response.ok) {
        Alert.alert("Error", `Could not send comment (${response.status})`);
        return;
      }

      setText("");
      setAttachedFile(null);
      // Belt-and-suspenders: the ReceiveMessage broadcast should append
      // this in real time for everyone in the group, but call loadMessages()
      // too so your own comment always shows up even if that push never
      // lands (e.g. group broadcast misconfigured on the backend).
      loadMessages();
    } catch (err) {
      console.error("Send review error:", err);
      Alert.alert("Error", "Could not reach server. Check your connection.");
    } finally {
      setSending(false);
    }
  }

  const isAdmin = role.toLowerCase() === "admin";
  const isPending = submission?.status?.toLowerCase() === "pending";
  const canModerate = isAdmin && isPending;

  return (
    <LinearGradient
      colors={["#382f54", "#203652", "#14513b"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}
    >
      <View style={styles.blobA} />
      <View style={styles.blobB} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <Feather name="arrow-left" size={18} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {submission ? submission.title : "File"}
            </Text>
            <View
              style={[
                styles.liveDot,
                connectionStatus === "connected"
                  ? styles.liveDotOn
                  : connectionStatus === "connecting"
                    ? styles.liveDotConnecting
                    : styles.liveDotOff,
              ]}
            />
          </View>

          {loading ? (
            <ActivityIndicator color="#FFFFFF" style={{ marginTop: 24 }} />
          ) : error ? (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={14} color="#DC2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : submission ? (
            <>
              <BlurView intensity={35} tint="light" style={styles.topCard}>
                <TouchableOpacity
                  style={styles.fileRow}
                  onPress={handleOpenFile}
                  disabled={opening}
                  activeOpacity={0.7}
                >
                  <View style={styles.fileIconBadge}>
                    <Feather name="file-text" size={20} color="#7C3AED" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fileName}>
                      {fileNameFromPath(submission.filePath)}
                    </Text>
                    {submission.description ? (
                      <Text style={styles.fileMeta}>
                        {submission.description}
                      </Text>
                    ) : null}
                    <Text style={styles.fileMeta}>
                      Sent {formatDate(submission.createdOn)}
                    </Text>
                  </View>
                  {opening ? (
                    <ActivityIndicator color="#9CA3AF" />
                  ) : (
                    <Feather name="external-link" size={18} color="#9CA3AF" />
                  )}
                </TouchableOpacity>

                <View
                  style={[styles.statusBadge, statusStyle(submission.status)]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      { color: statusTextColor(submission.status) },
                    ]}
                  >
                    {submission.status}
                  </Text>
                </View>

                {canModerate ? (
                  <View style={styles.moderationSection}>
                    {statusError ? (
                      <Text style={styles.inlineError}>{statusError}</Text>
                    ) : null}

                    {!showRejectInput ? (
                      <View style={styles.moderationButtons}>
                        <TouchableOpacity
                          onPress={handleApprove}
                          disabled={updatingStatus}
                          activeOpacity={0.85}
                          style={{ flex: 1 }}
                        >
                          <LinearGradient
                            colors={["#382f54", "#203652", "#14513b"]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={styles.approveButton}
                          >
                            {updatingStatus ? (
                              <ActivityIndicator color="#FFFFFF" size="small" />
                            ) : (
                              <>
                                <Feather
                                  name="check"
                                  size={16}
                                  color="#FFFFFF"
                                />
                                <Text style={styles.approveButtonText}>
                                  Approve
                                </Text>
                              </>
                            )}
                          </LinearGradient>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.rejectButton}
                          onPress={() => setShowRejectInput(true)}
                          disabled={updatingStatus}
                        >
                          <Feather name="x" size={16} color="#DC2626" />
                          <Text style={styles.rejectButtonText}>Reject</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View>
                        <TextInput
                          style={[styles.input, styles.textArea]}
                          placeholder="Reason for rejecting"
                          placeholderTextColor="#9CA3AF"
                          value={rejectionReason}
                          onChangeText={setRejectionReason}
                          multiline
                        />
                        <View style={styles.moderationButtons}>
                          <TouchableOpacity
                            style={[styles.rejectButton, { flex: 1 }]}
                            onPress={handleRejectConfirm}
                            disabled={updatingStatus}
                          >
                            {updatingStatus ? (
                              <ActivityIndicator color="#DC2626" size="small" />
                            ) : (
                              <Text style={styles.rejectButtonText}>
                                Confirm rejection
                              </Text>
                            )}
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.cancelButton}
                            onPress={() => {
                              setShowRejectInput(false);
                              setRejectionReason("");
                              setStatusError(null);
                            }}
                            disabled={updatingStatus}
                          >
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                ) : null}
              </BlurView>

              <Text style={styles.sectionLabel}>Comments</Text>

              {loadingMessages && !refreshing ? (
                <ActivityIndicator
                  color="#FFFFFF"
                  style={{ marginBottom: 12 }}
                />
              ) : messagesError ? (
                <View style={styles.errorBox}>
                  <Feather name="alert-circle" size={14} color="#DC2626" />
                  <Text style={styles.errorText}>{messagesError}</Text>
                </View>
              ) : (
                <FlatList
                  ref={listRef}
                  data={messages}
                  keyExtractor={(item) => String(item.id)}
                  contentContainerStyle={{ paddingBottom: 12 }}
                  onContentSizeChange={() => scrollToBottom(false)}
                  onLayout={() => scrollToBottom(false)}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={handleRefresh}
                      tintColor="#FFFFFF"
                    />
                  }
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>No comments yet.</Text>
                  }
                  renderItem={({ item }) => {
                    // Messages I sent are styled/aligned differently from
                    // messages sent to me, based on the real sender id.
                    const isMine = item.senderId === currentUserId;

                    return (
                      <View
                        style={[
                          styles.bubbleRow,
                          isMine
                            ? styles.bubbleRowMine
                            : styles.bubbleRowTheirs,
                        ]}
                      >
                        {isMine ? (
                          <LinearGradient
                            colors={["#3d3458", "#223853"]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.bubble}
                          >
                            <Text
                              style={[
                                styles.bubbleAuthor,
                                { color: "#FFFFFF" },
                              ]}
                            >
                              {item.senderName}
                            </Text>
                            {item.content ? (
                              <Text
                                style={[
                                  styles.bubbleText,
                                  { color: "#FFFFFF" },
                                ]}
                              >
                                {item.content}
                              </Text>
                            ) : null}
                            {item.newFile ? (
                              <TouchableOpacity
                                style={[
                                  styles.bubbleAttachment,
                                  { backgroundColor: "rgba(255,255,255,0.2)" },
                                ]}
                                onPress={() =>
                                  Linking.openURL(buildFileUrl(item.newFile!))
                                }
                              >
                                <Feather
                                  name="paperclip"
                                  size={13}
                                  color="#FFFFFF"
                                />
                                <Text
                                  style={[
                                    styles.bubbleAttachmentText,
                                    { color: "#FFFFFF" },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {fileNameFromPath(item.newFile)}
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                            <Text
                              style={[
                                styles.bubbleMeta,
                                { color: "rgba(255,255,255,0.8)" },
                              ]}
                            >
                              to {item.receiverName}
                            </Text>
                          </LinearGradient>
                        ) : (
                          <View style={[styles.bubble, styles.bubbleTheirs]}>
                            <Text
                              style={[
                                styles.bubbleAuthor,
                                { color: "#7C3AED" },
                              ]}
                            >
                              {item.senderName}
                            </Text>
                            {item.content ? (
                              <Text style={styles.bubbleText}>
                                {item.content}
                              </Text>
                            ) : null}
                            {item.newFile ? (
                              <TouchableOpacity
                                style={styles.bubbleAttachment}
                                onPress={() =>
                                  Linking.openURL(buildFileUrl(item.newFile!))
                                }
                              >
                                <Feather
                                  name="paperclip"
                                  size={13}
                                  color="#6B7280"
                                />
                                <Text
                                  style={styles.bubbleAttachmentText}
                                  numberOfLines={1}
                                >
                                  {fileNameFromPath(item.newFile)}
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                            <Text style={styles.bubbleMeta}>
                              to {item.receiverName}
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  }}
                />
              )}

              {attachedFile ? (
                <View style={styles.attachedFileRow}>
                  <Feather name="paperclip" size={14} color="#6B7280" />
                  <Text style={styles.attachedFileName} numberOfLines={1}>
                    {attachedFile.name}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setAttachedFile(null)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="x" size={14} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>
              ) : null}

              <BlurView intensity={35} tint="light" style={styles.inputRow}>
                <TouchableOpacity
                  style={styles.attachButton}
                  onPress={handleAttachFile}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="paperclip" size={18} color="#7C3AED" />
                </TouchableOpacity>
                <TextInput
                  style={styles.messageInput}
                  placeholder="Write a comment"
                  placeholderTextColor="#9CA3AF"
                  value={text}
                  onChangeText={setText}
                />
                <TouchableOpacity
                  onPress={handleSend}
                  disabled={sending}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={["#382f54", "#203652", "#14513b"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[
                      styles.sendButton,
                      sending && styles.sendButtonDisabled,
                    ]}
                  >
                    {sending ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.sendButtonText}>Send</Text>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </BlurView>
            </>
          ) : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

function statusStyle(status: string) {
  switch (status.toLowerCase()) {
    case "approved":
      return { backgroundColor: "#DCFCE7" };
    case "rejected":
      return { backgroundColor: "#FEE2E2" };
    case "pending":
    default:
      return { backgroundColor: "#FEF3C7" };
  }
}

function statusTextColor(status: string) {
  switch (status.toLowerCase()) {
    case "approved":
      return "#15803D";
    case "rejected":
      return "#B91C1C";
    case "pending":
    default:
      return "#92400E";
  }
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
    bottom: -40,
    right: -50,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    marginBottom: 16,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  liveDotOn: {
    backgroundColor: "#22C55E",
  },
  liveDotConnecting: {
    backgroundColor: "#FBBF24",
  },
  liveDotOff: {
    backgroundColor: "#EF4444",
  },
  topCard: {
    borderRadius: 22,
    padding: 18,
    marginBottom: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  fileIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: "#F3E8FF",
    alignItems: "center",
    justifyContent: "center",
  },
  fileName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  fileMeta: {
    fontSize: 12,
    color: "#6B7280",
    marginTop: 2,
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 100,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(254,242,242,0.95)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 6,
  },
  errorText: {
    color: "#DC2626",
    fontSize: 13,
    flexShrink: 1,
  },
  inlineError: {
    color: "#DC2626",
    fontSize: 13,
    marginBottom: 8,
  },
  moderationSection: {
    marginTop: 16,
  },
  moderationButtons: {
    flexDirection: "row",
    gap: 10,
  },
  approveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 14,
    paddingVertical: 12,
  },
  approveButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  rejectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    backgroundColor: "#FEE2E2",
  },
  rejectButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#DC2626",
  },
  cancelButton: {
    marginTop: 10,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  cancelButtonText: {
    fontSize: 13,
    color: "#6B7280",
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 10,
    marginLeft: 4,
  },
  emptyText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.8)",
  },
  bubbleRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  bubbleRowMine: {
    justifyContent: "flex-end",
  },
  bubbleRowTheirs: {
    justifyContent: "flex-start",
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "85%",
  },
  bubbleTheirs: {
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  bubbleAuthor: {
    fontSize: 12,
    fontWeight: "700",
  },
  bubbleText: {
    fontSize: 14,
    color: "#111827",
    marginTop: 3,
  },
  bubbleAttachment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.05)",
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  bubbleAttachmentText: {
    fontSize: 12,
    color: "#374151",
    flexShrink: 1,
  },
  bubbleMeta: {
    fontSize: 11,
    color: "#9CA3AF",
    marginTop: 4,
  },
  attachedFileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 8,
  },
  attachedFileName: {
    flex: 1,
    fontSize: 12,
    color: "#374151",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  attachButton: {
    padding: 4,
  },
  input: {
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#F9FAFB",
    marginBottom: 10,
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  messageInput: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
  },
  sendButton: {
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
});
