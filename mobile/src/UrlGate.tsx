import { theme } from './theme';
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

type Props = {
  initialUrl: string;
  errorMessage?: string;
  onSave: (url: string) => void;
};

export function isLocalhostViewerUrl(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

export function UrlGate({ initialUrl, errorMessage, onSave }: Props) {
  const [value, setValue] = useState(initialUrl || 'http://192.168.1.x:5173/m');
  const [localError, setLocalError] = useState<string | null>(null);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>doodleforge</Text>
        <Text style={styles.body}>
          On the laptop run `ipconfig getifaddr en0` and start `npm run web`. Enter the
          LAN URL below (must end with /m). Laptop and phone need the same Wi-Fi.
        </Text>
        {(errorMessage || localError) && (
          <Text style={styles.error}>{localError ?? errorMessage}</Text>
        )}
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.1.42:5173/m"
          placeholderTextColor={theme.muted}
          value={value}
          onChangeText={setValue}
        />
        <Pressable
          style={styles.button}
          onPress={() => {
            const trimmed = value.trim();
            if (!trimmed) {
              setLocalError('Enter a viewer URL.');
              return;
            }
            let parsed: URL;
            try {
              parsed = new URL(trimmed);
            } catch {
              setLocalError('Invalid URL.');
              return;
            }
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              setLocalError('URL must start with http:// or https://');
              return;
            }
            if (isLocalhostViewerUrl(trimmed)) {
              setLocalError(
                'localhost on the phone is the phone itself. Use the laptop LAN IP from ipconfig getifaddr en0.',
              );
              return;
            }
            setLocalError(null);
            onSave(trimmed);
          }}
        >
          <Text style={styles.buttonText}>Save & open</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.canvas,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  title: {
    color: theme.foreground,
    fontSize: 22,
    fontWeight: '700',
  },
  body: {
    color: theme.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  error: {
    color: theme.error,
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    backgroundColor: theme.input,
    color: theme.foreground,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: theme.onAccent,
    fontWeight: '700',
    fontSize: 16,
  },
});
