# Areté Android [![Build Areté Android](https://github.com/iamluisgb/arete-android/actions/workflows/build-android.yml/badge.svg)](https://github.com/iamluisgb/arete-android/actions/workflows/build-android.yml)

Capacitor wrapper para la PWA de Areté. App Android nativa con GPS en background, Google Sign-In nativo y Google Drive backup.

## Requisitos

- **Node.js** 22+
- **JDK** 21
- **Android Studio** 2024+ con SDK 26+ (solo para desarrollo local — no es para publicar)

## Flujo de desarrollo

```bash
# 1. Instalar dependencias
npm install

# 2. Sincronizar web con Android
npm run sync

# 3. Construir APK debug e instalar
npm run build:android:debug

# 4. O abrir Android Studio directamente
npm run open:android
```

Los archivos fuente web viven en `/www/`. Es la única fuente de verdad. No edites los archivos copiados en `android/app/src/main/assets/public/` — se regeneran con `npm run sync`.

## Build de release

```bash
# Crear archivo keystore.properties a partir del ejemplo
cp android/keystore.properties.example android/keystore.properties

# Editar con las credenciales reales (NO commitear este archivo)
nano android/keystore.properties

# Construir AAB firmado
npm run build:android:release
```

## Subir a Play Store

El AAB firmado se genera en: `android/app/build/outputs/bundle/release/app-release.aab`

1. Crear cuenta en [Play Console](https://play.google.com/console) ($25 pago único)
2. Crear nueva app
3. Subir el AAB en "Producción" o "Internal testing"
4. Completar el form de contenido, privacidad, categoría

### Variables de ambiente para CI

El workflow de GitHub Actions requiere estos secrets (configurar en Settings → Secrets):

| Secret | Cómo obtenerlo |
|--------|---------------|
| `ANDROID_KEYSTORE_BASE64` | `base64 -i ~/.keystores/arete-upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | Contraseña del keystore (guardar en 1Password) |
| `ANDROID_KEY_ALIAS` | `arete-upload` |
| `ANDROID_KEY_PASSWORD` | Contraseña de la llave (guardar en 1Password) |

Ejemplo de trigger con tag:
```bash
git tag v1.0.0
git push origin v1.0.0
```

El workflow generará automáticamente un GitHub Release con el AAB adjunto.

## Estructura del proyecto

```
/
├── android/               # Proyecto Android nativo (Capacitor)
│   ├── app/src/main/      # Código Android
│   ├── build.gradle       # Config del build
│   └── keystore.properties # [gitignore] Firma de release
├── www/                   # Source de verdad (PWA → WebView)
│   ├── js/                # JavaScript modular
│   ├── app.css            # Estilos
│   ├── index.html         # EntryPoint
│   ├── manifest.json      # PWA manifest
│   └── sw.js              # Service Worker (cache assets)
├── .github/workflows/     # CI/CD (GitHub Actions)
├── tests/                 # Tests Vitest
├── capacitor.config.ts    # Config de Capacitor
└── package.json
```

## Permisos Android

| Permiso | Motivo |
|---------|--------|
| `ACCESS_FINE_LOCATION` | GPS en carreras |
| `ACCESS_COARSE_LOCATION` | Compatibilidad |
| `WAKE_LOCK` | Mantener CPU activa en background |
| `VIBRATE` | Alertas táctiles de series/repas |
| `INTERNET` | Google Sign-In y Drive API |

Los permisos de ubicación se solicitan solo al iniciar una carrera, no al abrir la app.

## Debug

```bash
# Ver logs en Android Studio o ADB
adb logcat

# Limpiar build
npm run clean:android
```

## Publicación previa

Antes de cada release verificar:
- [ ] `npm run build:android:debug` en limpio (sin errores)
- [ ] `npm run test` pasa
- [ ] GPS funciona en carrera de prueba (instalar APK debug → iniciar carrera → verificar tracks)
- [ ] Google Sign-In funciona (login de prueba)
- [ ] Google Drive backup funciona (si el usuario tiene OAuth configure)
- [ ] Build release genera AAB firmado correctamente

## Referencias

- [Capacitor Docs](https://capacitorjs.com/docs)
- [Google Sign-In Capacitor](https://github.com/capawesome-team/capacitor-google-sign-in)
- [Firebase Google Sign-In](https://firebase.google.com/docs/auth/android/google-signin)
- [Play Console Setup](https://developer.android.com/distribute/console)
