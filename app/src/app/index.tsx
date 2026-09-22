import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

// M1 placeholder Home: just enough to reach Record and prove the capture flow end to end.
// The real Home (category grid, sections, sticky bar, My uploads badge) is M3 (SPEC section 3).
export default function Home() {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('app.name')}</Text>
      <Pressable
        style={styles.button}
        onPress={() => router.push({ pathname: '/record', params: { category: 'live_person' } })}
      >
        <Text style={styles.buttonText}>Record</Text>
      </Pressable>
      <Pressable style={[styles.button, styles.secondary]} onPress={() => router.push('/uploads')}>
        <Text style={styles.buttonText}>My uploads</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 24 },
  title: { fontSize: 20, fontWeight: '700' },
  button: { backgroundColor: '#4f9eff', paddingHorizontal: 32, paddingVertical: 16, borderRadius: 24, minHeight: 48, justifyContent: 'center' },
  secondary: { backgroundColor: '#999' },
  buttonText: { color: 'white', fontSize: 18, fontWeight: '600' },
});
