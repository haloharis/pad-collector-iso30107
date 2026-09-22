import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  type VideoFile,
} from 'react-native-vision-camera';
import { CAPTURE_TARGET } from '../lib/captureMeta';

const COUNTDOWN_SECONDS = 3;
const MIN_RECORD_SECONDS = 5;
const MAX_RECORD_SECONDS = 10;

type Phase = 'countdown' | 'recording' | 'stopping';

export default function RecordScreen() {
  // M1: category selection is a placeholder — the real picker (SPEC section 3) is M3 work.
  const { category = 'live_person' } = useLocalSearchParams<{ category?: string }>();

  const { hasPermission, requestPermission } = useCameraPermission();
  const [permissionDenied, setPermissionDenied] = useState(false);
  const requestedPermission = useRef(false);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [phase, setPhase] = useState<Phase>('countdown');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [elapsed, setElapsed] = useState(0);

  const camera = useRef<Camera>(null);
  const device = useCameraDevice(facing);
  const format = useCameraFormat(device, [
    { videoResolution: { width: CAPTURE_TARGET.width, height: CAPTURE_TARGET.height } },
    { fps: CAPTURE_TARGET.fps },
  ]);
  const fps = format ? Math.max(format.minFps, Math.min(CAPTURE_TARGET.fps, format.maxFps)) : CAPTURE_TARGET.fps;

  // Ask for camera permission only when this screen is reached (SPEC section 3 / 7).
  useEffect(() => {
    if (hasPermission || requestedPermission.current) return;
    requestedPermission.current = true;
    requestPermission().then((granted) => {
      if (!granted) setPermissionDenied(true);
    });
  }, [hasPermission, requestPermission]);

  // 3-second countdown, then auto-start recording.
  useEffect(() => {
    if (!hasPermission || phase !== 'countdown') return;
    if (countdown <= 0) {
      startRecording();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission, phase, countdown]);

  // Elapsed timer while recording; auto-stop at MAX_RECORD_SECONDS.
  useEffect(() => {
    if (phase !== 'recording') return;
    if (elapsed >= MAX_RECORD_SECONDS) {
      stopRecording();
      return;
    }
    const t = setTimeout(() => setElapsed((e) => e + 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, elapsed]);

  function startRecording() {
    if (!camera.current) return;
    setPhase('recording');
    setElapsed(0);
    camera.current.startRecording({
      fileType: 'mp4',
      videoCodec: CAPTURE_TARGET.codec,
      onRecordingFinished: (video: VideoFile) => {
        router.replace({
          pathname: '/review',
          params: {
            uri: video.path.startsWith('file://') ? video.path : `file://${video.path}`,
            width: String(video.width),
            height: String(video.height),
            duration: String(video.duration),
            facing,
            category,
          },
        });
      },
      onRecordingError: (error) => {
        console.error('recording failed', error);
        router.back();
      },
    });
  }

  function stopRecording() {
    if (phase !== 'recording') return;
    setPhase('stopping');
    camera.current?.stopRecording();
  }

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>
          {permissionDenied
            ? 'We need camera access to record your video. Allow it in Settings to continue.'
            : 'Requesting camera access…'}
        </Text>
        {permissionDenied && (
          <Pressable style={styles.button} onPress={() => Linking.openSettings()}>
            <Text style={styles.buttonText}>Open Settings</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>No {facing} camera found on this device.</Text>
      </View>
    );
  }

  const canStopManually = phase === 'recording' && elapsed >= MIN_RECORD_SECONDS;

  return (
    <View style={styles.container}>
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={phase === 'countdown' || phase === 'recording'}
        video={true}
        audio={false}
        fps={fps}
        videoHdr={false}
        videoStabilizationMode="off"
        isMirrored={false}
        outputOrientation="preview"
        videoBitRate={CAPTURE_TARGET.videoBitRateMbps}
        resizeMode="cover"
      />

      {/* Preview-only guide; never composited into the saved file. */}
      <View pointerEvents="none" style={styles.oval} />

      <View style={styles.topBar}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{category}</Text>
        </View>
      </View>

      {phase === 'countdown' && countdown > 0 && (
        <View style={styles.center}>
          <Text style={styles.countdown}>{countdown}</Text>
        </View>
      )}

      {(phase === 'recording' || phase === 'stopping') && (
        <View style={styles.bottomBar}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${(elapsed / MAX_RECORD_SECONDS) * 100}%` }]} />
          </View>
          <Text style={styles.timerText}>{elapsed}s</Text>
          {canStopManually && (
            <Pressable style={styles.button} onPress={stopRecording}>
              <Text style={styles.buttonText}>Stop</Text>
            </Pressable>
          )}
        </View>
      )}

      {phase === 'countdown' && (
        <Pressable
          style={[styles.button, styles.flipButton]}
          onPress={() => setFacing((f) => (f === 'front' ? 'back' : 'front'))}
        >
          <Text style={styles.buttonText}>Flip</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  message: { color: 'white', fontSize: 16, textAlign: 'center', marginBottom: 16 },
  oval: {
    position: 'absolute',
    alignSelf: 'center',
    top: '20%',
    width: '70%',
    aspectRatio: 0.75,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  topBar: { position: 'absolute', top: 48, alignSelf: 'center' },
  chip: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  chipText: { color: 'white', fontSize: 16 },
  countdown: { color: 'white', fontSize: 96, fontWeight: '700' },
  bottomBar: { position: 'absolute', bottom: 48, left: 24, right: 24, alignItems: 'center', gap: 12 },
  progressTrack: { width: '100%', height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: '#4f9eff' },
  timerText: { color: 'white', fontSize: 16 },
  button: { backgroundColor: '#4f9eff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, minHeight: 48, justifyContent: 'center' },
  flipButton: { position: 'absolute', bottom: 48, right: 24 },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600', textAlign: 'center' },
});
