import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arete.app',
  appName: 'Areté',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      backgroundColor: '#131313',
      launchShowDuration: 1500,
      launchAutoHide: true,
    },
    GoogleAuth: {
      scopes: ['profile', 'email'],
      // clientClientId debe configurarse con el OAuth client ID de Google Cloud Console
      // para Android (com.arete.app)
      androidClientId: '',
    },
    Geolocation: {
      showPermissionsPrompt: false,
    },
  },
};

export default config;
