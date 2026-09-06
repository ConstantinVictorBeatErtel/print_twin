import { theme } from './src/theme';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { UrlGate, isLocalhostViewerUrl } from './src/UrlGate';
import { ViewerScreen } from './src/ViewerScreen';

const STORAGE_KEY = 'ptw.viewerUrl';

function envUrl(): string {
  const raw = process.env.EXPO_PUBLIC_VIEWER_URL?.trim() ?? '';
  return raw;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fromEnv = envUrl();
      const stored = (await AsyncStorage.getItem(STORAGE_KEY)) ?? '';
      const candidate = fromEnv || stored;
      if (cancelled) return;
      if (candidate && !isLocalhostViewerUrl(candidate)) {
        setUrl(candidate);
      } else if (candidate && isLocalhostViewerUrl(candidate)) {
        setGateError(
          'Saved URL used localhost. Use the laptop LAN IP from ipconfig getifaddr en0.',
        );
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = useCallback(async (next: string) => {
    await AsyncStorage.setItem(STORAGE_KEY, next);
    setGateError(undefined);
    setUrl(next);
  }, []);

  const onLoadError = useCallback((message: string) => {
    setUrl(null);
    setGateError(message);
  }, []);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={theme.accent} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {url ? (
        <ViewerScreen url={url} onLoadError={onLoadError} />
      ) : (
        <UrlGate
          initialUrl={envUrl() || 'http://192.168.1.x:5173/m'}
          errorMessage={gateError}
          onSave={onSave}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.canvas },
  boot: {
    flex: 1,
    backgroundColor: theme.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
