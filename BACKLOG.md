# Areté Android — Backlog & Canvas

> Última actualización: 2026-05-08

---

## 🗂️ Canvas

### Producto
PWA de fitness (Areté) empaquetada como app Android nativa vía Capacitor 8.3.1. Web app vivo en `iamluisgb.github.io/arete` y APK distribuido por GitHub Releases. Foco actual: paridad con la PWA + GPS background fiable.

### Stack
- **Web**: HTML/CSS/JS vanilla, Service Worker, Capacitor Web APIs
- **Android**: Capacitor 8.3.1, `targetSdk = 36` (Android 16), `minSdk = 23`
- **Plugins nativos custom**: `AreteLocation` (foreground service GPS) en [`android/app/src/main/java/com/arete/app/location/`](android/app/src/main/java/com/arete/app/location/)
- **CI**: GitHub Actions builds APK al push a `main`

### Dispositivos objetivo
- **Pixel 7a / Android 16** (dispositivo principal del usuario)
- Emulador Pixel 7a / API 36 / WebView 133 (reproduce el bug del header — fuerza `WEBVIEW_VERSION_WITH_SAFE_AREA_FIX = 140` del plugin Capacitor SystemBars)

### Ya validado
- ✅ GPS background con pantalla bloqueada (foreground service nativo + buffer en SharedPreferences + resync al volver)
- ✅ Header / safe-area en Android 16: inyección nativa de `--safe-area-inset-*` desde `MainActivity` con 5 retries para ganar la carrera al plugin SystemBars
- ✅ Auto-pause re-habilitado por defecto

### Hipótesis de arquitectura ya descartadas
- Auto-pause vía sólo JS: descartado, Doze mata timers — por eso pasamos a foreground service nativo
- Mantener GPS vivo con `<audio>` keep-alive: hack legacy que dejará de ser necesario en cuanto este backlog cierre

### 🪓 Decisiones arquitectónicas activas
- **2026-05-13 — Ruptura del storage Android ↔ PWA**: la app Android va a evolucionar hacia la arquitectura local-first descrita en FEAT-006 (SQLite + exports + sync cifrado). La **PWA publicada** en `iamluisgb.github.io/arete` **sigue funcionando con `localStorage`/`IndexedDB`/Drive como hasta ahora**. Implicación: el código de `data.js`/`run-store.js` debe ramificar por plataforma (probablemente vía `isCapacitor`). Cualquier feature nueva que toque storage tiene que considerar las dos ramas.

### Riesgos abiertos
- Auto-pause no detecta inmovilidad real (P1)

---

## 🧪 Entorno de desarrollo

### Emulador principal: `pixel7a_android16`

| Atributo | Valor |
|---|---|
| Nombre AVD | `pixel7a_android16` |
| Perfil hardware | Pixel 7a (Google) |
| Android | 16.0 ("Baklava") · API 36 ext 19 |
| System image | `system-images/android-36-ext19/google_apis_playstore/x86_64/` |
| ABI | x86_64 (4 cores, 2 GB RAM) |
| Pantalla | 1080×2400 @ 420 dpi |
| Play Services | sí (`google_apis_playstore` — necesario para `FusedLocationProviderClient`) |
| Por qué este | Reproduce el escenario real del usuario: Android 16 + WebView 133 (< 140), que es justo donde el plugin Capacitor `SystemBars` deja de inyectar `--safe-area-inset-*`. Sin este emulador no se podía reproducir el bug del header. |

### Otros AVDs disponibles
- `arete-test` y `arete_test` — Android 14 / Pixel genérico, x86_64. Sirven para validar que los fixes no rompen Android 14.
- `Pixel_3a_API_34_extension_level_7_x86_64` — Android 14, sólo si hace falta probar densidad/forma diferente.

### Herramientas y rutas

Las herramientas de Android no están en `PATH` por defecto. Usar siempre las rutas absolutas o exportar el PATH al inicio de la sesión:

```bash
export PATH="/usr/local/share/android-commandlinetools/cmdline-tools/latest/bin:\
/usr/local/share/android-commandlinetools/platform-tools:\
/usr/local/share/android-commandlinetools/emulator:$PATH"
```

| Herramienta | Ruta |
|---|---|
| `adb` | `/usr/local/share/android-commandlinetools/platform-tools/adb` |
| `emulator` | `/usr/local/share/android-commandlinetools/emulator/emulator` |
| `avdmanager` | `/usr/local/share/android-commandlinetools/cmdline-tools/latest/bin/avdmanager` |
| `scrcpy` | `/usr/local/bin/scrcpy` (instalado vía `brew install scrcpy`) |
| Java 21 | `/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` (export `JAVA_HOME` antes de `gradlew`) |

### Pautas de uso

**1. Arrancar el emulador**
```bash
emulator -avd pixel7a_android16 &
# espera ~30-60s a que arranque
adb wait-for-device
adb shell getprop sys.boot_completed   # debe devolver "1"
```
NO usar la flag `-no-window`: el AVD `arete-test` la tenía y daba problemas para mirrorrarlo con scrcpy.

**2. Ver el emulador en una ventana del Mac (espejo)**
```bash
scrcpy -s emulator-5554 --window-title="Areté Emulator"
```
scrcpy permite además grabar vídeo, pulsar en el host con el ratón y enviar input por teclado — más cómodo que la ventana nativa del emulador.

**3. Compilar e instalar el APK desde el repo**
```bash
cd /Users/lgb/Desktop/workspace/projects/arete-android
JAVA_HOME=/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
  ./android/gradlew -p android assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.arete.app/.MainActivity
```

**4. Capturar screenshot del estado actual**
```bash
adb exec-out screencap -p > /tmp/shot.png
# luego Read /tmp/shot.png para que Claude lo vea
```

**5. Logs durante una repro**
```bash
# Crashes: stack trace completo
adb logcat -b crash -d > /tmp/crash.log

# Logs de la app filtrados por nuestros tags
adb logcat -s AreteInset:V LocationPlugin:V LocationTrackingService:V Capacitor:V

# Limpiar buffer antes de empezar la repro
adb logcat -c
```

**6. Inspeccionar WebView con Chrome DevTools**
1. En el emulador, abrir Chrome → `chrome://version` → anotar versión (133 en este AVD).
2. En el Mac, abrir Chrome → `chrome://inspect/#devices`.
3. La WebView de Areté aparece como "WebView in com.arete.app" → "inspect".

**7. Reset de estado para probar "primer arranque" (BUG-001)**
```bash
adb shell pm clear com.arete.app           # borra datos + permisos concedidos
adb shell am start -n com.arete.app/.MainActivity
```
Esto es lo que hay que ejecutar antes de reproducir el crash de permisos GPS — el flag `-r` de `adb install` NO resetea permisos.

**8. Simular GPS en el emulador (útil para BUG-002)**
- En el emulador: tres puntos `...` → Location → poner ruta GPX o coordenada manual.
- Por consola: `adb emu geo fix <lon> <lat>`.
- Para inmovilidad real (BUG-002 auto-pause), fijar coordenadas y NO moverlas durante 60 s.

**9. Limitaciones del emulador**
- **No reproduce Doze mode fielmente**: el emulador no entra en Doze a menos que se fuerce (`adb shell dumpsys deviceidle force-idle`). Para validar GPS background real, pruébalo en el Pixel 7a físico antes de declarar OK.
- **No tiene sensor de presión barométrica ni magnetómetro real**: si en el futuro se añade altimetría avanzada, el emulador no servirá.
- **WebView 133**: este AVD trae WebView 133 (debajo del corte de 140 del plugin SystemBars). Es la propiedad que lo hace útil. Si actualizas Play Services / WebView en el emulador y sube de 140, dejará de reproducir el bug del header — en ese caso, recrear el AVD desde cero.

---

## 📐 Norma de trabajo

Cuando se empieza a abordar un issue del backlog:

1. **Cambiar el estado** del issue a 🟡 *investigando* y añadir una sección `**Plan**` justo debajo de las hipótesis, con la lista numerada de tareas concretas para resolverlo (no genéricas: nombres de archivo, líneas, comandos).
2. **Anotar cada avance** dentro del propio issue bajo una sección `**Bitácora**`, en orden cronológico inverso (lo más reciente arriba). Cada entrada lleva fecha (`YYYY-MM-DD`), qué se intentó, resultado y siguiente paso. Si una hipótesis queda descartada, marcarla tachada (`~~hipótesis~~`) y explicar por qué.
3. **Cerrar el issue** sólo cuando se cumplen los criterios de **Aceptación**. Cambiar estado a 🟢 *hecho*, dejar la bitácora completa (es el historial del fix) y añadir el commit/PR que lo cerró.
4. **Si aparecen sub-bugs** durante la investigación, abrirlos como nuevos issues en el backlog en vez de mezclarlos con el original — un issue, un fix.

Esta norma vale para BUG-* y TASK-*. La idea: que cualquiera (incluido yo en 3 meses) pueda abrir el backlog y entender qué se intentó, qué falló y por qué la solución final fue la que fue, sin tener que arquear el `git log`.

---

## 📋 Backlog

### Leyenda
- **Prioridad**: P0 (rompe app) · P1 (degrada experiencia) · P2 (deuda / limpieza) · P3 (idea / feature nueva)
- **Estado**: 🔴 abierto · 🟡 investigando · 🟢 hecho

---

### BUG-001 · 🟢 P0 — Crash al conceder permiso GPS en primer arranque

**Síntoma**
En la primera instalación, al abrir la app aparece el diálogo de permisos de GPS. Al pulsar "Permitir", la app se cierra inesperadamente. Si el usuario la vuelve a abrir, ya funciona normalmente.

**Hipótesis a investigar**
1. **`ForegroundServiceStartNotAllowedException`**: en Android 14+, justo tras cerrar el diálogo de permisos la actividad pasa por `PAUSED → RESUMED` y `startForegroundService()` puede no estar permitido en ese instante.
2. **`POST_NOTIFICATIONS` no concedido en runtime**: en Android 13+ el foreground service requiere notificación visible. Si el permiso no se ha pedido aún, `startForeground()` puede fallar con `ForegroundServiceDidNotStartInTimeException`.
3. **JS llama a `AreteLocation.start()` antes de que la actividad esté lista**: el callback de `Geolocation.requestPermissions()` puede dispararse en una ventana en la que el `LocationPlugin` aún no está cargado.
4. **NPE en `WebView` ya destruido**: si la concesión del permiso recreó la actividad, la referencia de `MainActivity.onResume → injectSafeArea` puede correr contra un WebView nulo.

**Archivos sospechosos**
- [`android/app/src/main/java/com/arete/app/location/LocationPlugin.java`](android/app/src/main/java/com/arete/app/location/LocationPlugin.java) — método `start()` líneas 57-72
- [`android/app/src/main/java/com/arete/app/location/LocationTrackingService.java`](android/app/src/main/java/com/arete/app/location/LocationTrackingService.java) — `onStartCommand` y `startForeground()`
- [`www/js/ui/running-tracker.js`](www/js/ui/running-tracker.js) — flujo `start() → _startGpsBackground()`
- [`android/app/src/main/AndroidManifest.xml`](android/app/src/main/AndroidManifest.xml) — declaraciones de permisos

**Cómo reproducir**
1. `adb shell pm clear com.arete.app` (resetea permisos sin desinstalar)
2. `adb shell am start -n com.arete.app/.MainActivity`
3. Disparar el flujo que pide GPS, aceptar el diálogo → observar crash
4. `adb logcat -b crash -d > /tmp/crash.log` para capturar stack trace

**Plan**
1. Reproducir el crash en el emulador `pixel7a_android16` con `pm clear`. Sin stack trace real no se puede acotar la hipótesis correcta.
2. Una vez con stack trace, atacar la hipótesis específica. Si `ForegroundServiceStartNotAllowedException`: usar `Handler(Looper.getMainLooper()).postDelayed(..., 100)` (NUNCA `Thread.sleep` en UI thread). Catch específico, no `Exception`.
3. Si la pista es `POST_NOTIFICATIONS`: pedir desde Java con `requestPermissionForAlias` declarado en `@CapacitorPlugin(permissions = {...})`, NO desde JS con `App.requestPermissions` (esa API no acepta permisos arbitrarios de Android).
4. Validar la fix con `pm clear` repetido antes de marcar 🟢.

**Bitácora**
- **2026-05-08** — Crash reproducido limpio en emulador `pixel7a_android16` con `adb shell pm clear com.arete.app` + relanzar + navegar a Running → "Iniciar carrera" → "Empezar (Libre)". Stack trace capturado:
  ```
  java.lang.SecurityException: Starting FGS with type location
    callerApp=ProcessRecord{...:com.arete.app} targetSDK=36
    requires permissions:
      all of [android.permission.FOREGROUND_SERVICE_LOCATION]
      any of [ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION]
    and the app must be in the eligible state...
  at LocationTrackingService.startInForeground(LocationTrackingService.java:75)
  at LocationTrackingService.onStartCommand(LocationTrackingService.java:67)
  ```
  **Diagnóstico**: la hipótesis #1 era correcta pero más simple de lo escrito. No es race `PAUSED→RESUMED` por el diálogo. Es que el flujo JS llama `plugin.start()` SIN haber pedido `ACCESS_FINE_LOCATION` antes. `navigator.geolocation.watchPosition` dispara el diálogo de forma asíncrona y mientras tanto el FGS arranca sin permiso. Android 14+ con `targetSdk=36` exige el permiso ANTES de `startForeground(...FOREGROUND_SERVICE_TYPE_LOCATION)` o tira `SecurityException` que mata el proceso. ~~Las hipótesis 2 (POST_NOTIFICATIONS), 3 (plugin no cargado) y 4 (NPE WebView) quedan descartadas~~ — no aparecen en el stack trace.
- **2026-05-08** — Fix aplicado en 3 capas defensivas:
  1. **Native `LocationTrackingService.startInForeground`**: try/catch alrededor del `startForeground(...)`. Si tira `SecurityException`, log + `stopSelf()` + devolver `false`. `onStartCommand` ahora devuelve `START_NOT_STICKY` cuando arranque falla (sin retry sistémico que volvería a crashear).
  2. **Native `LocationPlugin.start`**: comprueba `ACCESS_FINE_LOCATION` o `ACCESS_COARSE_LOCATION` con `checkSelfPermission`. Si ninguna concedida, `call.reject("Location permission not granted")`. Evita siquiera iniciar el servicio en estado fatal.
  3. **JS `_startGpsBackground`**: usa `Capacitor.Plugins.Geolocation.checkPermissions()` y, si no `granted`, `requestPermissions({ permissions: ['location'] })`. Si tras eso sigue sin estar concedido, sale silenciosamente (el `navigator.geolocation.watchPosition` foreground seguirá pidiéndolo). Esto es el flujo que dispara el diálogo nativo del sistema en el momento correcto.
- **2026-05-08** — Validado: `pm clear` + relanzar + tap "Iniciar carrera" → "Empezar (Libre)" → ahora aparece el diálogo nativo de permisos ("Allow Areté to access this device's location?"). Tras aceptar "While using the app", la carrera arranca normalmente: cronómetro corriendo, mapa cargado, app viva. NO crash. NO `FATAL EXCEPTION` en logcat. Comparado con repro previa idéntica donde el proceso moría en <300 ms.
- **2026-05-08** — Pendiente: validar en Pixel 7a real (no marco 🟢 hasta confirmación).
- **2026-05-08** — Confirmado por el usuario: validado en Pixel 7a real (Android 16). Primer arranque limpio, diálogo de permisos aparece, app no crashea. Cerrado en commit `0ca4a7c`.

**Archivos modificados**
- [`android/app/src/main/java/com/arete/app/location/LocationTrackingService.java`](android/app/src/main/java/com/arete/app/location/LocationTrackingService.java) — try/catch en `startInForeground` + `boolean` retorno + `START_NOT_STICKY` cuando falla.
- [`android/app/src/main/java/com/arete/app/location/LocationPlugin.java`](android/app/src/main/java/com/arete/app/location/LocationPlugin.java) — permission check antes de `startForegroundService`.
- [`www/js/ui/running-tracker.js`](www/js/ui/running-tracker.js) — `Geolocation.checkPermissions`/`requestPermissions` al inicio de `_startGpsBackground`.

**Aceptación**
- ✅ Crash NO ocurre tras `pm clear` + primer arranque + tap "Empezar" en Iniciar carrera (validado en emulador `pixel7a_android16`)
- ✅ Stack trace original capturado y archivado arriba
- ✅ Validado en Pixel 7a real (Android 16)

---

### BUG-002 · 🔴 P1 — Auto-pause no detecta inmovilidad

**Síntoma**
Durante una carrera, el usuario se queda parado varios minutos en un punto y el cronómetro sigue contando. El indicador de auto-pausa nunca aparece, aunque `autoPauseEnabled = true` por defecto.

**Hipótesis a investigar**
1. **Filtro de precisión drop-in**: [`running-tracker.js:530`](www/js/ui/running-tracker.js#L530) descarta lecturas con `accuracy > 30`. Si el dispositivo está parado en un sitio con cobertura GPS marginal, la precisión se degrada y NINGUNA lectura llega al bloque de auto-pause. `_lastPos` se queda obsoleto y `_stillSince` nunca se inicia.
2. **Origen de las posiciones en foreground**: el foreground service nativo emite `locationUpdate` cada 2s. Pero en foreground también puede haber un `watchPosition` JS activo. Si los timestamps colisionan o vienen del filtro `accuracy > 30`, el cálculo `ts - this._stillSince > 5000` nunca se dispara.
3. **Umbral demasiado agresivo**: la línea 544 exige sólo 5 s de inmovilidad pero también exige `_lastPos` y `isStill`. Si por la hipótesis 1 no entra ninguna posición, el umbral es irrelevante.
4. **`speed` del fused provider parado pero ruidoso**: cuando el GPS está estático, `speed` puede oscilar entre `0` y `0.6 m/s` por error del sensor. La condición `< 0.5 m/s` falla por intermitencia.

**Archivos sospechosos**
- [`www/js/ui/running-tracker.js`](www/js/ui/running-tracker.js) — método `_onPosition` líneas 520-606
- [`android/app/src/main/java/com/arete/app/location/LocationTrackingService.java`](android/app/src/main/java/com/arete/app/location/LocationTrackingService.java) — config de `LocationRequest` (interval, displacement, priority)

**Plan de diagnóstico**
1. Añadir `console.log` (o un toggle de debug) en `_onPosition` que registre cada lectura: `accuracy`, `speed`, `d`, `isStill`, `_stillSince`, `_autoPaused`
2. Repro real: salir a la calle, parar 60 s, leer log
3. Si el problema es el filtro de precisión: subir el umbral a `accuracy > 50` o aplicarlo SOLO cuando `_lastPos` ya existe (no descartar la primera lectura), o mover el bloque de auto-pause antes del filtro **sin re-gatear con `!isLowAccuracy`** (eso anula el cambio).
4. Si el problema es el ruido de speed: si se promedia, primero hay que GUARDAR `speed` en `_recentPoints` (hoy sólo guarda `{ lat, lng, time }`). Sin ese cambio, cualquier media de `p.speed` da `NaN`/`null` y el código cae al fallback.
5. Bajar el umbral de tiempo a 3 s pero exigir 3 lecturas consecutivas `isStill` (más robusto que ventana de 5 s)

**Bitácora**
- **2026-05-08** — Primer intento revertido (vino dentro del diff equivocado de BUG-001). Bugs en el intento:
  - Promedió `speed` desde `_recentPoints.slice(-3)`, pero `_recentPoints` no almacena `speed` (sólo `lat/lng/time`). Filter siempre vacío → `avgSpeed = null` → fallback `d < 2`. Promedio era código muerto.
  - Movió el bloque arriba del filtro de accuracy ✓ (idea correcta), pero re-añadió `isStill && !isLowAccuracy` con `isLowAccuracy = accuracy > 30`. Eso anula el propio cambio: el comportamiento neto sigue siendo el de antes.

**Aceptación**
- Parado en la calle 60 s con la app en foreground → indicador de auto-pausa aparece antes de los 10 s
- Reanudar marcha → auto-resume en < 3 s
- Tiempo "auto-pausado" se descuenta del elapsed

---

### TASK-003 · 🟢 P2 — Eliminar keep-alive audio legacy

**Contexto**
Antes del foreground service nativo, mantenedíamos el WebView vivo en background reproduciendo un WAV silencioso (200 Hz a -50 dB) + un oscilador Web Audio + Media Session. Chrome Android detectaba samples PCM no-cero y creaba un foreground service implícito que mantenía JS y GPS despiertos.

Ya no es necesario: nuestro `LocationTrackingService` nativo cumple esa función con notificación visible y `WAKE_LOCK` partial. El audio fantasma es código muerto que:
- Activa permiso de audio innecesario en algunos lanzadores
- Aparece como "reproducción en curso" en notificación de medios
- Consume CPU en background sin propósito
- Confunde a usuarios que ven el icono de audio activo

**Cambios**
1. **Eliminar** las funciones `startKeepAlive`, `stopKeepAlive`, `resumeKeepAlive`, `_createKeepAliveAudio`, `_startOscillator` y los globals `_keepAliveAudio`, `_keepAliveOsc`, `_keepAliveActive`, `_keepAliveWavUrl` de [`www/js/ui/audio.js`](www/js/ui/audio.js) (líneas 33-146 aprox)
2. **Eliminar** los re-exports en [`www/js/ui/running-audio.js`](www/js/ui/running-audio.js) líneas 2 y 4
3. **Limpiar llamadas** en [`www/js/ui/running.js`](www/js/ui/running.js):
   - Línea 7: quitar `startKeepAlive, stopKeepAlive, resumeKeepAlive` del import
   - Línea 183: borrar `resumeKeepAlive()`
   - Líneas 540 y 653: borrar `startKeepAlive()`
   - Líneas 737 y 862: borrar `stopKeepAlive()`
4. **Conservar** `beep`, `vibrate`, `getAudioCtx` y los beeps de splits/work/rest — esos siguen siendo feedback útil del usuario, no son keep-alive

**Riesgos**
- Verificar que ningún flujo dependía implícitamente del `AudioContext.resume()` que hacía `resumeKeepAlive`. Si algún beep deja de sonar tras volver del background, restaurar sólo el `ctx.resume()`.
- Confirmar que la notificación del foreground service ya cubre el caso del `MediaMetadata` (visualmente — la notificación nativa muestra "Areté · Carrera activa", no necesitamos el lock-screen player de mediaSession).

**Bitácora**
- **2026-05-08** — Primer intento revertido. Quitó las funciones de `audio.js` y los re-exports de `running-audio.js`, pero **dejó vivas 4 llamadas a `startKeepAlive()`/`stopKeepAlive()`** en `running.js` (líneas 533, 646, 730, 855). Resultado: la app habría reventado en runtime con `ReferenceError` al iniciar/parar carrera. Cleanup incompleto. Recordatorio: tras quitar imports, ejecutar `grep -rn "startKeepAlive\|stopKeepAlive\|resumeKeepAlive" www/` y verificar que no queden referencias antes de declarar hecho.
- **2026-05-08** — Segundo intento, ejecución limpia siguiendo la norma:
  1. `audio.js`: borrado el bloque entero líneas 33-146 (comentario + 4 globals + `_writeString` + `_getKeepAliveWavUrl` + `_createKeepAliveAudio` + `_startOscillator` + `startKeepAlive` + `stopKeepAlive` + `resumeKeepAlive`). El archivo pasa de 146 → 31 líneas, conserva sólo `getAudioCtx`/`beep`/`vibrate`.
  2. `running-audio.js`: import y export reducidos a `{ beep, vibrate }`.
  3. `running.js`: import reducido (línea 7) + borradas las 5 llamadas (`resumeKeepAlive` en el listener `visibilitychange`, `startKeepAlive` en `restoreRun` y `startGpsRun`, `stopKeepAlive` en `stopGpsRun` y `closeLiveOverlay`). El bloque entero del `visibilitychange` se elimina — su único propósito era llamar `resumeKeepAlive`.
  4. Auditoría: `grep -rn "KeepAlive\|keepAlive" www/` → 0 hits. `grep -rn` en `android/app/src/main/assets/public/` (bundle tras `cap copy`) → 0 hits.
  5. Otros importadores de `audio.js` (`timer.js`, `training-timer.js`) sólo usan `getAudioCtx`/`beep`/`vibrate`. Sin colaterales.
  6. `gradlew assembleDebug` exitoso. Bundle pesa 115 líneas menos.

**Cambios totales**
- `www/js/ui/audio.js`: -115 líneas (de 146 → 31).
- `www/js/ui/running-audio.js`: -3 / +3 (sin keep-alive en import/export).
- `www/js/ui/running.js`: -13 / +1 (5 llamadas + bloque `visibilitychange` + import sin los 3 nombres).

**Aceptación**
- ✅ `grep -rn "KeepAlive" www/` no devuelve resultados
- ✅ Build pasa (`gradlew assembleDebug` SUCCESS)
- 🟡 Pendiente validación en Pixel 7a real: carrera de 30 min con pantalla bloqueada sigue registrando GPS sin pérdida (el FGS nativo es ahora el único sostén — esto valida que efectivamente lo era ya)
- 🟡 Pendiente: confirmar que no aparece ningún ítem de "reproducción de audio" en el panel de notificaciones durante una carrera

---

### FEAT-004 · 🔴 P3 — Catálogo de benchmark tests de rendimiento

**Contexto**
Areté ya muestra PRs de carrera (1K, 5K, 10K, 21.1K). Encaja con el posicionamiento "Fuerza. Resistencia. Sin elegir." extender esto a un catálogo de tests de rendimiento reconocidos — Murph, Fran, 1RM de los básicos, tests de bodyweight — para que el usuario mida progreso de la misma forma que un atleta serio: comparándose con tiempos objetivos en pruebas estandarizadas, no contra el espejo.

**Hipótesis de diseño**
Mejor un catálogo curado (6-8 tests) + creación de benchmarks custom, que intentar cubrir el universo entero. Si el usuario crea muchos custom, eso nos da señal de qué añadir al catálogo curado en una iteración futura.

**Tests candidatos (a discutir antes de scope)**
- **Metcons clásicos**: Murph (1mi + 100 pull-ups + 200 push-ups + 300 squats + 1mi, ±chaleco 20lb), Fran (21-15-9 thrusters + pull-ups), Helen (3 rondas: 400m + 21 KB swings + 12 pull-ups).
- **Strength 1RM**: sentadilla, peso muerto, press banca, press militar. Ya está la sentadilla y press militar en el dashboard como ejercicios — falta el "best ever" persistente.
- **Bodyweight benchmarks**: dominadas máximas (un set), flexiones en 2 min, plancha estática máxima.
- **Endurance no-correr**: 2km de remo (si Luis usa remo en gimnasio), Cooper test (12 min corriendo distancia máxima).

**Preguntas abiertas para Luis**
1. ¿Qué tests haces tú regularmente que querrías trackear primero? (Define el MVP del catálogo).
2. ¿Murph se mide solo en tiempo, o también queremos guardar "con/sin chaleco"? Si con chaleco, ¿el campo es un toggle o peso libre?
3. ¿Los 1RM ya tienen sitio en el flujo Fuerza actual o queremos un sitio único "PRs y benchmarks" unificado para todo?
4. ¿Mostramos un nivel/percentil estimado (e.g. "Murph en 45 min ≈ atleta intermedio")? Útil para motivar, pero requiere tablas de referencia.

**Plan**
*(Sin plan todavía — pendiente discusión de las preguntas abiertas para definir scope mínimo).*

**Aceptación**
- *(Sin criterios todavía — definir tras decidir scope MVP).*

---

### FEAT-005 · 🔴 P3 — Replanteamiento del bottom nav (IA escalable)

**Contexto**
El footer actual `Inicio · Fuerza · Running · Cuerpo · Más` está organizado por **taxonomía de features**, no por intención del usuario. Por eso al crecer revienta: cada feature nueva pide un slot propio. El "Más" ya es síntoma de la deuda (NN/g: ítems en "More" reciben 5-10× menos clicks). FEAT-004 (catálogo de tests) y un futuro blog/guía no tienen sitio claro sin reventar la barra.

**Investigación de referentes**
- **Strava (redesign 2025)**: pasaron de `Home · Explore · Record · Profile · Training` a `Home · Maps · Record · Groups · You` — fusionaron Profile + Training en "You" para liberar espacio. Lección: cuando crece el set, se **reagrupa por intención**, no se añade.
- **Hevy**: sólo 2 tabs (Workout + Profile). Toda la variedad vive en jerarquía interna (carpetas, rutinas).
- **SugarWOD** (500k atletas, trackea Murph y todos los CrossFit benchmarks): el catálogo de benchmarks NO es un tab — vive como subsección dentro del Personal Logbook.
- **Nike Training Club**: contenido editorial blended dentro de secciones relevantes, no como tab aparte.
- **Material 3 / iOS HIG**: tope duro de 5 ítems en bottom nav.

**Propuesta de diseño**

```
┌──────────┬──────────┬─────⊕─────┬──────────┬──────────┐
│  Inicio  │ Entreno  │  Empezar  │  Cuerpo  │    Tú    │
└──────────┴──────────┴───────────┴──────────┴──────────┘
```

- **Inicio**: dashboard del día + rail horizontal "Guía" (artículos del blog) + actividad reciente.
- **Entreno**: contenedor de todo lo entrenable. Tabs internos `Fuerza · Running · Tests · Plan`. FEAT-004 (benchmarks) entra aquí como tab "Tests" sin tocar el footer. Sticky-tab: recuerda la última pestaña usada.
- **⊕ Empezar (FAB centrado, patrón Material 3 "expressive bottom app bar")**: abre sheet con quick-start (Empezar carrera · Sesión de fuerza · Test · Custom). Resuelve "quiero entrenar YA" en 2 taps desde cualquier pantalla, mitiga el clic extra de Entreno.
- **Cuerpo**: peso, medidas, nutrición, sueño/recovery cuando lleguen. Layout tipo Inicio (cards), no tabs.
- **Tú**: PRs (5K/10K/1RM/Murph/todos), historial, perfil, ajustes, **Biblioteca** (archivo completo del blog). Patrón Strava "You".

**Dónde vive el blog/Guía**
1. **Rail "Guía"** en Inicio bajo el dashboard (3-5 cards de artículos recientes).
2. **Cards contextuales** dentro de Entreno y Cuerpo (e.g. en `Running → Plan`: "Lee: Plan 10K en 8 semanas"; en `Cuerpo → Nutrición`: "Lee: Come como un animal"). Patrón Nike Training Club.
3. **Tú → Biblioteca**: archivo completo navegable.

Razón: si el blog es contenido editorial/educativo de soporte, NO merece tab propio — gana visibilidad apareciendo donde es útil. Si fuera contenido principal del producto (la gente abre la app para leer, no para entrenar), entonces sí cambiaría toda la propuesta. Esto es **la hipótesis a validar antes de scope final** (ver preguntas abiertas).

**Por qué es robusto**
1. Estable a 2-3 años de features nuevas: lo que venga cae en Entreno/Tú/Cuerpo sin tocar el footer.
2. Mata el antipatrón "Más" actual.
3. FAB centrado es el patrón Material 3 moderno (embebido en la bar, no flotando encima).
4. Reutiliza patrón ya probado en la app: la pantalla Running actual usa tabs internos (Actividad/Historial/Progreso/Plan) — el usuario ya entiende el gesto.
5. Migración por fases posible sin big-bang.

**Tradeoffs honestos**
- Usuarios que hoy van directos a Fuerza/Running con 1 tap pasan a 2. Mitigado por FAB ⊕ y sticky-tab en Entreno.
- "Cuerpo" carga más al absorber nutrición/medidas/recovery. Aceptable si se organiza como Inicio (cards) en vez de tabs.
- El FAB necesita `padding-bottom` extra en pantallas con CTAs propios ("Iniciar carrera", "Empezar entreno") para no taparlos.
- Cambio de IA grande → riesgo de confundir al usuario actual. Mitigado por migración por fases.

**Preguntas abiertas**
1. **Rol del blog**: ¿editorial de soporte (mi recomendación, va a rail+Biblioteca) o producto principal (entonces gana tab propio y replanteamos el footer)?
2. **Naming**: ¿"Entreno" o "Hoy"? ¿"Tú" o "Mí" o "Perfil"? ¿"Cuerpo" sigue o pasa a "Salud"?
3. **FAB ⊕**: ¿siempre visible o sólo cuando hay sentido (e.g. ocultarlo en flujos de carrera activa para no estorbar)?
4. **Acceso a sesión actual en curso**: si hay carrera/sesión activa, ¿el FAB la prioriza ("Continuar") o seguimos teniendo el banner persistente arriba?

**Plan (en fases, una vez resueltas las preguntas)**
1. **Fase 0 — IA + mock**: aterrizar nombres y wireframes definitivos. Validar con 1-2 pruebas de pasillo.
2. **Fase 1 — Tú**: crear el tab "Tú" absorbiendo Perfil + PRs + Historial + Ajustes. Aún sin tocar Fuerza/Running. El footer pasa de 5 a 5 (sólo renaming "Más" → "Tú"). Riesgo bajo, valida el modelo.
3. **Fase 2 — Entreno**: crear "Entreno" con tabs internos Fuerza/Running/Plan. Los tabs viejos Fuerza/Running desaparecen del footer. Footer pasa a `Inicio · Entreno · Cuerpo · Tú` (4 ítems).
4. **Fase 3 — FAB ⊕**: añadir el bottom app bar Material 3 con FAB centrado. Footer final 5 slots con ⊕ en el centro.
5. **Fase 4 — Tests** (depende de FEAT-004): añadir tab "Tests" dentro de Entreno con el catálogo de benchmarks.
6. **Fase 5 — Guía**: rail en Inicio + Biblioteca en Tú + cards contextuales.

**Aceptación**
- *(Sin criterios todavía — definir tras decidir las 4 preguntas abiertas).*

---

### FEAT-006 · 🔴 P3 — Storage local-first en Android (SQLite + exports + sync sin backend)

> ⚠️ **Scope: SOLO Android.** Decisión arquitectónica del 2026-05-13: la PWA publicada en `iamluisgb.github.io/arete` se queda con `localStorage`/`IndexedDB`/Drive como hasta hoy. Esta migración aplica únicamente al APK Android. Implica ramificar `data.js`/`run-store.js` por plataforma — ver "Estrategia de ramificación" abajo.

**Contexto**
La arquitectura actual (`localStorage` ~50MB para la DB ligera + `IndexedDB` para rutas pesadas + `Drive` como backup last-write-wins) funciona como MVP pero no escala y choca con tres muros: rendimiento, sync multi-dispositivo fiable y portabilidad real de los datos. Vista desde la filosofía "el usuario es dueño y no hay backend", el modelo objetivo es **local-first** (Ink & Switch, 2019) — el mismo marco que usan Obsidian, Logseq, Standard Notes.

**Estrategia de ramificación (Android ↔ PWA)**
- `data.js` ya tiene la pauta `const isCapacitor = window.Capacitor?.isNativePlatform?.()`. La aprovechamos como switch.
- API pública del módulo (`loadDB`, `saveDB`, `safeGet`, `safeSet`, `setOnQuotaError`, etc.) se mantiene idéntica para los callers — todo el cambio ocurre tras la fachada.
- Implementaciones detrás:
  - PWA (`isCapacitor === false`): camino actual sin tocar.
  - Android (`isCapacitor === true`): camino SQLite.
- `run-store.js` (IndexedDB para rutas pesadas) se mantiene en PWA y se sustituye por tablas SQLite en Android.
- Riesgo: drift de comportamiento entre las dos ramas. Mitigación: tests de contrato sobre la API pública que ambas implementaciones deben pasar.

**Diagnóstico de lo actual**
1. **`localStorage` es síncrono** y bloquea el UI thread en cada `saveDB`. Cada escritura serializa la base entera como un único string JSON → O(n) por save, independiente de qué cambió.
2. **El split `localStorage` ↔ `IndexedDB` es manual y frágil**: lista hardcoded `HEAVY_FIELDS = ['route', 'splits', 'hrTimeSeries', 'hrZoneTimes', 'segments']` en [`run-store.js:6`](www/js/run-store.js#L6). Cualquier feature nueva con datos pesados que olvide actualizarla llena `localStorage` en silencio.
3. **Sync Drive es last-write-wins bruto**: móvil A edita y sube; móvil B sin bajar primero edita y sube → cambios de A perdidos. `deletedIds` existe pero no es un sistema de tombstones completo.
4. **Cero portabilidad estándar**: si el usuario quiere irse, le entregamos un JSON propietario de Areté. No hay export GPX/FIT (formatos universales running) ni integración con Health Connect / HealthKit.
5. **Cero encriptación en reposo**: dispositivo robado o blob de Drive comprometido = datos de salud en claro.

**Arquitectura objetivo**

```
┌───────────────────────────────────────────────────────────────┐
│                     SQLite (.db file)                         │
│      ← single source of truth, transaccional, indexada        │
└───────────────────────────────────────────────────────────────┘
   ↓ API uniforme (@capacitor-community/sqlite, nativo en Android)

   Capa de sync: CRDT (Automerge) o LWW por campo + timestamps + tombstones
        ↓
   Drive = transporte tonto (blob cifrado .db.enc), no servidor de sync
        ↓
   Encriptación con clave derivada de passphrase (Argon2), guardada en
   Android Keystore. Drive no puede leer nada.

   Exports estándar (always available):
    - Runs → GPX / FIT (universal)
    - Workouts → JSON / Markdown plano
    - Salud → Health Connect (Android) / HealthKit (futuro iOS)
```

**Por qué encaja con la filosofía**
- **Dueño real**: el `.db` SQLite es portable, abierto, sobrevive 30 años. SQLite es el formato de archivo más usado del mundo. Si Areté cierra mañana, el usuario abre su `.db` con cualquier visor SQLite y todo está ahí.
- **Sin backend**: Drive es transporte de archivos, no servicio de sync. Cero infra que mantener. Y al ir cifrado, Google no ve los datos.
- **Sync sin perder datos**: con CRDTs o LWW-por-record con timestamps, dos dispositivos editan offline y al sincronizar hay merge determinista.
- **Portabilidad real**: GPX/FIT/Health Connect = el usuario NO está atrapado.
- **Privacidad real**: encriptación con clave que ni nosotros podemos pinchar.

**Plan por fases**

**Fase 1 · SQLite como source of truth** *(2-3 semanas)*
- Añadir `@capacitor-community/sqlite` (~v6.x en mayo 2026). En Android usa SQLite nativo (no WASM, sin coste de bundle).
- Definir esquema SQL: tablas `workouts`, `body_logs`, `running_logs`, `running_routes`, `custom_programs`, `settings`, `deleted_records` (tombstones), `schema_version`.
- Migrador one-shot: al primer arranque tras update, leer `localStorage.arete` + IndexedDB `areteRuns`, escribir todo a `arete.db`, mantener backup en `localStorage.arete.backup` 1 versión.
- Reemplazar `loadDB`/`saveDB` en [`data.js`](www/js/data.js) por wrappers async sobre SQLite. API pública del módulo sin cambios para no romper callers.
- `localStorage` queda solo como cache rapidísimo de "última vista cargada" (≤100KB). El source of truth pasa a SQLite.
- **Entregable**: build idéntica funcionalmente, pero todas las escrituras son atómicas + transaccionales + escalan a GBs.
- **Riesgo**: migración con pérdida de datos si el migrador falla a la mitad. Mitigación: mantener `localStorage.arete.backup` 7 días tras la migración + flag `migrationCompleted` para no reintentar.

**Fase 2 · Exports estándar** *(1-2 semanas)*
- Export GPX por carrera: serializar `coords[]` + timestamps a `<trkpt>` con extensiones para HR/cadence.
- Export FIT por carrera: usar `@garmin/fitsdk` (Apache 2.0). Más complejo pero es el formato de oro para correr.
- Export JSON/Markdown de workouts: cada sesión a un `.md` con frontmatter YAML + tabla de series.
- Export completo: `.zip` con `arete.db` + carpeta `runs/` (GPX) + carpeta `workouts/` (MD). Botón "Exportar todo" en Ajustes.
- **Entregable**: el usuario puede llevarse sus datos a Strava, Garmin Connect, TrainingPeaks, Obsidian, etc., sin nuestra app.
- **Riesgo**: nulo — feature aditiva, no toca el storage existente.

**Fase 3 · Encriptación en reposo** *(1 semana)*
- Passphrase opcional en onboarding ("Cifra tus datos · Si pierdes el móvil, sólo tú puedes leer tus datos"). Derivar clave con Argon2id (cost ~256MB, ~1s en móvil decente).
- Guardar clave derivada en Android Keystore. SQLCipher (extensión de SQLite con cifrado AES-256) protege el `.db` localmente.
- Backup a Drive: blob `arete.db.enc` AES-256-GCM con nonce aleatorio por upload.
- Flujo de recovery en nuevo dispositivo: pedir passphrase, bajar `arete.db.enc` de Drive, descifrar, abrir.
- **Entregable**: dispositivo robado o Drive comprometido = datos ilegibles. Areté no tiene acceso a los datos del usuario ni teóricamente.
- **Riesgo**: si el usuario olvida la passphrase, pierde el backup. Mitigación: passphrase **opcional**, con disclaimer explícito. Sin passphrase, backup va en claro a Drive (estado actual).

**Fase 4 · Sync multi-dispositivo real** *(3-4 semanas)*
- Decidir entre CRDTs (Automerge) o LWW-por-record (con timestamps lógicos por dispositivo + tombstones reales en tabla `deleted_records`). Recomendación: empezar por LWW-por-record (más simple, suficiente para single-user-multi-device); subir a Automerge solo si vemos casos reales que LWW no resuelve.
- Sync con Drive deja de ser "subir blob completo" → pasa a un patrón checkpoint + log:
  - `arete.db.enc` (checkpoint mensual).
  - `changes-{deviceId}-{timestamp}.jsonl.enc` (delta log).
  - Al abrir app: bajar logs nuevos de otros dispositivos, mergear en local, opcionalmente compactar.
- UI de conflicto: cuando dos dispositivos editan el mismo record en offline, mostrar diff y dejar al usuario elegir.
- **Entregable**: el usuario instala Areté en móvil + tablet. Edita en offline en ambos. Al volver a red, todo se reconcilia sin perder nada.
- **Riesgo**: bugs sutiles de sync que solo aparecen con uso real prolongado. Mitigación: lanzar primero como flag opt-in beta.

**Fase 5 · Integración Health Connect / HealthKit** *(1-2 semanas)*
- Android: `@capacitor-community/health-connect` para escribir runs (distancia, duración, HR avg/max, calorías) en el panel de salud del OS.
- iOS (futuro): HealthKit equivalente cuando se haga build de iOS.
- Importar también: si el usuario tiene corazón con Apple Watch / Wear OS, importar las series HR.
- **Entregable**: tus runs aparecen automáticamente en Samsung Health / Google Fit / Apple Health. Y al revés.
- **Riesgo**: solicitud de permisos de salud espanta. Mitigación: explícito y opcional, con beneficios claros.

**Tradeoffs honestos**
- **Coste real**: 8-12 semanas para fases 1-3 (ataque inicial recomendado). Fases 4-5 son optativas según tracción del producto.
- **CRDTs son complejos**: Automerge tiene overhead de memoria y aún hay edge cases. Para single-user-multi-device, LWW-por-record es suficiente y mucho más simple — empezar por ahí.
- **Drift Android ↔ PWA**: ramificar la capa de storage implica mantener dos comportamientos. Mitigación: API pública idéntica detrás de fachada + tests de contrato.
- **Passphrase es fricción**: hacerla opcional con disclaimer claro. Sin passphrase, todo sigue igual de cómodo.
- **Dependencia de `@capacitor-community/sqlite`**: plugin mantenido por la comunidad. Riesgo bajo (es el estándar del ecosistema Capacitor), pero existe.

**Preguntas abiertas**
1. **Empezar por SQLite o por exports?** Mi recomendación: SQLite primero (Fase 1) porque desbloquea el resto. Pero exports (Fase 2) son más visibles para el usuario y dan "win" rápido. ¿Prioridad por valor visible o por solidez técnica?
2. **CRDT vs LWW-por-record**: ¿optamos por la solución simple ahora (LWW) y subimos a CRDT solo si lo necesitamos, o vamos directos a Automerge para no migrar dos veces?
3. **Encriptación obligatoria u opcional?** Obligatoria = más seguro pero fricción brutal en onboarding. Opcional = lo que recomiendo, con disclaimer claro. ¿Aceptas el tradeoff?
4. **Health Connect como early-win o late-stage?** Es relativamente cómodo de añadir y muy visible. Podría adelantarse antes que Fase 4 (sync) si entregar valor visible importa más que cerrar la sync.
5. **Interop Android ↔ PWA**: tras la ruptura, un mismo usuario con PWA en desktop + Android en móvil tiene dos stores diferentes. ¿Cómo bridge?
   - Opción A: Drive en formato JSON común — Android exporta/importa el `.db` SQLite a un JSON espejo que la PWA entiende. Significa mantener el conversor activo.
   - Opción B: explicitamos que son instalaciones independientes y NO sincronizan automáticamente — el usuario migra manualmente vía export/import.
   - Opción C: la PWA es read-only frente al backup de Android (la PWA carga el JSON de Drive pero no escribe a él). Útil para "ver datos desde el ordenador".

**Aceptación (a definir tras decidir scope)**
- Fase 1: migración no-destructiva probada con DB real de Luis (su instalación actual) + saves promedio <50ms.
- Fase 2: export completo `.zip` que reabre limpio en otro Areté + GPX que reabre en Strava/Garmin.
- Fase 3: backup en Drive no legible sin passphrase, validado con archivo abierto a mano.
- Fase 4: dos instalaciones en offline editan diferentes records y al syncar quedan idénticas.
- Fase 5: una carrera registrada en Areté aparece en Health Connect en < 5s.

---

## 🚦 Orden recomendado

```
✅ BUG-001 (P0) → ✅ TASK-003 (P2) → 🔴 BUG-002 (P1) → 🔴 FEAT-006-fase1 (P3)
   → 🔴 FEAT-005 (P3) → 🔴 FEAT-006-fase2 (P3) → 🔴 FEAT-004 (P3)
   → 🔴 FEAT-006-fase3-5 (P3, opcional según tracción)
```

**Razonamiento del orden**:
- **BUG-002** primero — siempre cerrar lo roto antes de tocar fundamentos.
- **FEAT-006 Fase 1 (SQLite) antes de FEAT-005 (IA)**: si vamos a reorganizar pantallas, mejor que el storage subyacente ya esté en su forma final — evita escribir código nuevo sobre el `localStorage` que vamos a jubilar.
- **FEAT-005 (IA) antes de FEAT-004 (Tests)**: como ya razonamos, los tests entran como tab dentro de "Entreno".
- **FEAT-006 Fase 2 (exports)** entre IA y Tests porque es independiente y entrega "win" visible (los usuarios verán "Exportar a Strava" como feature de marca).
- **FEAT-004 (Tests)** entra cuando ya hay SQLite y contenedor IA — y se modela limpio en una tabla `benchmark_results` desde día uno.
- **Fases 3-5 de FEAT-006** quedan optativas — el orden depende de prioridades del producto.
