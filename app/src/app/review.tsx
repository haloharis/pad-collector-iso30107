import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { randomUUID } from 'expo-crypto';
import { buildCameraCaptureMeta } from '../lib/captureMeta';
import { getSessionId } from '../lib/session';
import { saveCaptureMetaSidecar, saveVideoToPrivateStorage, sha256OfFile } from '../lib/videoStorage';

// Categories that are attacks on a real face show the "is this your own face" checkbox (SPEC section 3).
// M1 placeholder: the real category list/metadata comes from the server config in M3.
const REAL_FACE_CATEGORY = 'live_person';

export default function ReviewScreen() {
  const params = useLocalSearchParams<{
    uri: string;
    width: string;
    height: string;
    duration: string;
    facing: string;
    category: string;
  }>();
  const [showConfirm, setShowConfirm] = useState(false);
  const [faceIsOwn, setFaceIsOwn] = useState(false);
  const [saving, setSaving] = useState(false);

  const player = useVideoPlayer(params.uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  async function handleSave() {
    setSaving(true);
    try {
      const id = randomUUID();
      const video = {
        path: params.uri,
        width: Number(params.width),
        height: Number(params.height),
        duration: Number(params.duration),
      };
      const savedFile = await saveVideoToPrivateStorage(params.uri, id);
      const sha256 = await sha256OfFile(savedFile);
      const meta = buildCameraCaptureMeta(video, params.facing === 'back' ? 'back' : 'front');
      saveCaptureMetaSidecar(id, {
        id,
        session_id: getSessionId(),
        contributor_category: params.category,
        face_is_own: params.category === REAL_FACE_CATEGORY ? null : faceIsOwn,
        sha256,
        size_bytes: savedFile.size,
        capture_meta: meta,
        source: 'camera',
        created_at: new Date().toISOString(),
      });
      router.replace({ pathname: '/record-done', params: { category: params.category } });
    } catch (e) {
      console.error('save failed', e);
      setSaving(false);
    }
  }

  function handleRetake() {
    router.replace({ pathname: '/record', params: { category: params.category } });
  }

  return (
    <View style={styles.container}>
      <VideoView player={player} style={styles.video} contentFit="contain" nativeControls={false} />

      {!showConfirm && (
        <View style={styles.actions}>
          <Pressable style={[styles.button, styles.secondary]} onPress={handleRetake}>
            <Text style={styles.buttonText}>Retake</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => setShowConfirm(true)}>
            <Text style={styles.buttonText}>Keep</Text>
          </Pressable>
        </View>
      )}

      {showConfirm && (
        <View style={styles.sheet}>
          <Text style={styles.sheetRow}>
            Category: <Text style={styles.bold}>{params.category}</Text>{' '}
            <Text style={styles.link} onPress={() => setShowConfirm(false)}>
              Change
            </Text>
          </Text>

          {params.category !== REAL_FACE_CATEGORY && (
            <View style={styles.checkboxRow}>
              <Switch value={faceIsOwn} onValueChange={setFaceIsOwn} />
              <Text style={styles.checkboxLabel}>The face shown is my own</Text>
            </View>
          )}

          <Pressable style={styles.button} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Save</Text>}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  video: { flex: 1 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', padding: 24, gap: 16 },
  sheet: { padding: 24, gap: 16, backgroundColor: '#111', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  sheetRow: { color: 'white', fontSize: 16 },
  bold: { fontWeight: '700' },
  link: { color: '#4f9eff' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkboxLabel: { color: 'white', fontSize: 16, flexShrink: 1 },
  button: { flex: 1, backgroundColor: '#4f9eff', paddingVertical: 14, borderRadius: 24, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: '#444' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
