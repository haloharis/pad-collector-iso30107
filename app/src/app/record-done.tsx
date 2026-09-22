import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

export default function RecordDoneScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Saved on this phone</Text>
      <Text style={styles.subtitle}>It will upload the next time you are online.</Text>

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.secondary]}
          onPress={() => router.replace({ pathname: '/record', params: { category } })}
        >
          <Text style={styles.buttonText}>Record another</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={() => router.replace('/')}>
          <Text style={styles.buttonText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 16, textAlign: 'center', marginBottom: 24 },
  actions: { flexDirection: 'row', gap: 16, width: '100%' },
  button: { flex: 1, backgroundColor: '#4f9eff', paddingVertical: 14, borderRadius: 24, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: '#999' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
