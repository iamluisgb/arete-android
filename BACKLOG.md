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

## 🚦 Orden recomendado

```
✅ BUG-001 (P0)  →  ✅ TASK-003 (P2)  →  🔴 BUG-002 (P1)  →  🔴 FEAT-004 (P3)
```

BUG-002 antes que FEAT-004: arreglar lo que ya hay roto antes de añadir superficie nueva. FEAT-004 está bloqueado en discusión de scope (ver preguntas abiertas en el issue).
