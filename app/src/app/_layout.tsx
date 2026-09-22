import '../i18n';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { ensureInstall } from '../lib/install';
import { startUploadQueue } from '../lib/uploadQueue';

export default function RootLayout() {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensureInstall()
      .then(() => setReady(true))
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  // The queue resumes on app relaunch and drains as connectivity allows (SPEC section 6).
  useEffect(() => {
    if (!ready) return;
    return startUploadQueue();
  }, [ready]);

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
        <Text style={{ fontSize: 16 }}>Could not start: {error}</Text>
      </View>
    );
  }
  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Stack />;
}
