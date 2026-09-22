import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getQueueRows, processQueueOnce, scanAndEnqueueSidecars } from '../lib/uploadQueue';
import type { QueueRow } from '../lib/queueDb';

// M2 placeholder: just enough to observe queue state for the airplane-mode / force-kill /
// 10-in-a-row acceptance tests (SPEC section 8). The real My Uploads screen is M3.
export default function UploadsScreen() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    scanAndEnqueueSidecars();
    setRows(getQueueRows());
  }, []);

  useFocusEffect(refresh);

  async function uploadNow() {
    setRefreshing(true);
    await processQueueOnce();
    refresh();
    setRefreshing(false);
  }

  return (
    <View style={styles.container}>
      <Pressable style={styles.button} onPress={uploadNow} disabled={refreshing}>
        <Text style={styles.buttonText}>{refreshing ? 'Uploading…' : 'Upload now'}</Text>
      </Pressable>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        onRefresh={refresh}
        refreshing={refreshing}
        ListEmptyComponent={<Text style={styles.empty}>Nothing queued.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.id}>{item.id.slice(0, 8)}…</Text>
            <Text style={styles.status}>{item.status}</Text>
            <Text style={styles.meta}>
              {item.contributor_category} · attempt {item.attempts}
              {item.error ? ` · ${item.error.slice(0, 60)}` : ''}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 16 },
  button: { backgroundColor: '#4f9eff', paddingVertical: 14, borderRadius: 24, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  empty: { fontSize: 16, textAlign: 'center', marginTop: 32, color: '#666' },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#ddd', gap: 4 },
  id: { fontSize: 14, fontFamily: 'monospace' },
  status: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 14, color: '#555' },
});
