import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewErrorEvent, WebViewHttpErrorEvent } from 'react-native-webview/lib/WebViewTypes';

type Props = {
  url: string;
  onLoadError: (message: string) => void;
};

export function ViewerScreen({ url, onLoadError }: Props) {
  const reported = useRef(false);

  const fail = (message: string) => {
    if (reported.current) return;
    reported.current = true;
    onLoadError(message);
  };

  return (
    <View style={styles.root}>
      <WebView
        source={{ uri: url }}
        style={styles.webview}
        allowsInlineMediaPlayback
        bounces={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
        setDisplayZoomControls={false}
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures={false}
        contentInsetAdjustmentBehavior="never"
        originWhitelist={['*']}
        onError={(e: WebViewErrorEvent) => {
          fail(e.nativeEvent.description || 'Failed to load viewer');
        }}
        onHttpError={(e: WebViewHttpErrorEvent) => {
          fail(`Viewer HTTP ${e.nativeEvent.statusCode}`);
        }}
        onLoadEnd={() => {
          reported.current = false;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0b0d10',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0b0d10',
  },
});
