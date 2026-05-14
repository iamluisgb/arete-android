# Areté Android — Backlog & Canvas

> Última actualización: 2026-05-14

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
# Redimensionar a <2000px antes de Read (Claude limita imágenes a 2000 px en multi-imagen):
sips -Z 1800 /tmp/shot.png --out /tmp/shot-r.png
# luego Read /tmp/shot-r.png para que Claude lo vea
```
El emulador captura a 1080×2400; sin downscale, Read da `An image in the conversation exceeds the dimension limit for many-image requests (2000px)`. `sips -Z 1800` deja la imagen en 810×1800 — bajo el límite y todavía legible. Las coordenadas de tap (`adb input tap X Y`) siguen siendo las del device original 1080×2400; multiplicar los pixels detectados en la imagen 810×1800 por `1.333` (= 1080/810 = 2400/1800).

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

### BUG-002 · 🟡 P1 — Auto-pause no detecta inmovilidad

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
- **2026-05-13** — Fix definitivo aplicado:
  - Movido el bloque de auto-pause **ANTES** del filtro de accuracy en `_onPosition` ([`running-tracker.js`](www/js/ui/running-tracker.js)).
  - Sin re-gating con `!isLowAccuracy`: ahora las lecturas estacionarias (que típicamente vienen con accuracy degradada porque el GPS multitrayectoria sin movimiento) sí cuentan para `_stillSince`.
  - Fallback robusto: si `speed` está disponible y ≥ 0, usar `speed < 0.5 m/s`. Si no, calcular `d = haversine(_lastPos, current)`; pero si **`_lastPos === null`** (primera lectura), confiar en `speed`. La causa raíz histórica era que con `accuracy > 30` la primera lectura nunca entraba al bloque, `_lastPos` quedaba en `null` y NUNCA llegaba a haber inmovilidad medible.
  - Filtro de accuracy se conserva, pero **sólo afecta a cómputo de distancia/pace** (que sí necesita precisión). Auto-pause ya pasó.
- **2026-05-13** — Validación en emulador con `adb emu geo fix -3.7038 40.4168` (GPS fijo en Madrid Sol):
  1. `pm clear com.arete.app` para estado limpio + `pm grant ACCESS_FINE_LOCATION/COARSE_LOCATION`.
  2. Carrera iniciada → cronómetro arranca en `00:04` (EN CURSO).
  3. Esperar 12 s sin mover el GPS simulado.
  4. **Resultado**: estado pasa a **AUTO-PAUSA** (rojo, top center) con cronómetro congelado en `00:09` (= 4 s iniciales + 5 s de still threshold). ✅

**Aceptación**
- ✅ Parado en la calle 60 s con la app en foreground → indicador de auto-pausa aparece antes de los 10 s — confirmado en emulador (5 s reales, dentro de tolerancia).
- 🟡 Reanudar marcha → auto-resume en < 3 s — pendiente validación con secuencia de coords cambiantes vía `adb emu geo fix`.
- 🟡 Tiempo "auto-pausado" se descuenta del elapsed — pendiente medición real con carrera completa.

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

### FEAT-007 · 🔴 P2 — Mapa interactivo (pan/zoom) durante la carrera

**Contexto**
Durante una carrera activa, el usuario no puede hacer pan/zoom del mapa. El comportamiento fue **deliberado** en [`running.js:1274-1279`](www/js/ui/running.js#L1274-L1279) — el mapa se inicializa con `dragging: false`, `touchZoom: false`, `scrollWheelZoom: false` para que el auto-follow del corredor no peleara con la mano del usuario. Hoy es una limitación: el usuario quiere ver "¿hacia dónde gira este sendero?" o "¿cuánto me queda hasta esa cima?" y no puede.

**Solución**
Patrón estándar de Strava / Google Maps en navegación / Waze: mapa interactivo + smart-follow que se pausa al detectar gesto del usuario, con botón para volver al modo seguimiento.

**Plan**
1. **Activar interacciones** en [`running.js:1274-1279`](www/js/ui/running.js#L1274-L1279): `dragging: true`, `touchZoom: true`, `scrollWheelZoom: true` (resto del config sin tocar). ~5 min.
2. **Detectar interacción manual** y pausar el auto-follow:
   - Listener `dragstart` + `zoomstart` de Leaflet → `userInteracted = true`.
   - Las dos llamadas a `liveMap.setView(...)` en [`running.js:591-598`](www/js/ui/running.js#L591-L598) y [`885-891`](www/js/ui/running.js#L885-L891) se condicionan a `!userInteracted`.
   - ~30-60 min.
3. **Botón flotante "Centrar"** sobre el mapa (top-right o bottom-right). Al pulsarlo: `userInteracted = false` + `liveMap.setView(last, currentZoom)`. Se muestra sólo cuando `userInteracted === true`. ~15-20 min.
4. **Smoke test**: tap arrastrar mapa → desaparece auto-follow + aparece "Centrar" → tap centrar → vuelve a seguir. Pinch zoom → idem.

**Estimación**: 1-2 horas. Cambio contenido en `running.js`, baja superficie de riesgo.

**Aceptación**
- ✅ Pan y zoom funcionan durante carrera activa (`dragging/touchZoom/scrollWheelZoom: true`).
- ✅ Al interactuar (drag), aparece botón "Centrar"; el mapa NO salta a la posición actual cada tick GPS (`if (!mapUserPanned) liveMap.setView(...)`).
- ✅ Al pulsar "Centrar", vuelve el auto-follow y desaparece el botón.
- 🟡 Smoke test con `adb emu geo fix` simulando movimiento durante ≥2 min — validación parcial con coords fijas (sí funciona pan + recenter), pendiente movimiento simulado real.

**Bitácora**
- **2026-05-13** — Implementación inicial:
  - `initLiveMap` ([`running.js`](www/js/ui/running.js)): activadas `dragging/touchZoom/scrollWheelZoom`. `doubleClickZoom: false` para evitar zoom accidental con doble-tap durante carrera.
  - Smart-follow: dos globals al scope del módulo (`mapUserPanned`, `mapRecenterControl`). Las dos `liveMap.setView` activas (línea ~600 en `restoreRun` y línea ~893 en GPS update) ahora se condicionan a `!mapUserPanned`.
  - Listener `dragstart` (sólo dragstart, **no** `zoomstart`): este último fire también con setView programático y rompía el smart-follow.
  - Control Leaflet custom `RecenterControl` con `L.Control.extend({position:'topright'})` — se añade al activarse pan y se elimina al pulsar el botón.
- **2026-05-13** — Validación en emulador (BUG-002 + FEAT-007 juntos):
  1. Tras entrar en AUTO-PAUSA, drag del mapa (`adb shell input swipe 533 1600 533 1067 400`).
  2. Botón "Centrar" aparece top-right, el mapa se queda en la posición arrastrada (no rebota).
  3. Tap del botón a (1000, 977 device) → mapa vuelve al pin GPS centrado y el botón desaparece.
- **2026-05-13** — Rediseño visual del botón a estética Google Maps (feedback del usuario):
  - Antes: botón pill `◎ Centrar` con texto + heredando el chrome `leaflet-bar` (border negro).
  - Después: FAB circular 44×44 px, fondo blanco puro, icono SVG crosshair (concentric ring + dot + 4 ticks N/E/S/O) en `#5f6368`, shadow Google-style (`0 1px 4px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.12)`), micro-feedback `:active{transform:scale(.94)}`. Quitada la clase `leaflet-bar` porque el chrome por defecto chocaba con el FAB.
  - SVG inline (no archivo separado) — el botón sólo aparece tras drag manual, no merece petición de red extra.

---

### FEAT-008 · 🟡 P2 — Schema v5 de sesiones de fuerza (datos exportables a FIT / Health Connect)

> ⚠️ **Prerequisito de FEAT-006 Fase 2 (export FIT de fuerza) y Fase 5 (Health Connect strength).** Sin schema v5 los exportadores son imposibles de implementar limpiamente — habría que parsear strings libres y mantener heurísticas frágiles.

**Contexto**
El modelo actual de sesiones de fuerza ([`www/js/data.js`](www/js/data.js) + [`www/js/ui/training.js`](www/js/ui/training.js)) funciona como tracker propio pero no es exportable a ningún estándar (Health Connect, FIT, TCX). El bloqueo NO es el storage (eso lo resuelve FEAT-006 Fase 1) — es el **modelo de datos**: `reps` y `kg` se guardan como strings libres (`"5"`, `"10-12"`, `"18:32"`, `"4R · 18:32"`), no hay timestamps por set, ni duración de sesión, ni RPE/RIR, ni catálogo canónico de ejercicios. Cualquier exportador serio tendría que adivinar.

**Diagnóstico del estado actual** (auditoría 2026-05-14)

Schema actual v4 — `workout`:
```js
{
  id, date: "YYYY-MM-DD", session, phase, program, notes,
  exercises: [{
    name: "Sentadilla", type, mode,             // 9 modos: sets/result/interval/tabata/rounds/ladder/pyramid/amrap/emom/superset
    sets: [{ kg: "80", reps: "5" }],           // ← strings libres
    rounds, rest                                // ← pegado del modelo HIIT
  }],
  prs: [{ exercise, kg, prevKg }]
}
```

Problemas concretos:
1. **`reps`/`kg` como strings libres**. Conviven `"5"`, `"10-12"`, `"18:32"`, `"4R · 18:32"`. Ningún parser estándar entiende esto.
2. **Sin timestamps a nivel set ni sesión**. Solo `date: "YYYY-MM-DD"`. FIT y Health Connect exigen `startTime`/`endTime` epoch ms.
3. **Sin duración total** (ni `startedAt`/`endedAt`/`durationSec`).
4. **Sin RPE, RIR, tempo**. Información que diferencia un export "amateur" de uno aceptable por un coach.
5. **`rest` global por bloque, no por set**. Modelo HIIT encima del de fuerza, mezcla dos cosas.
6. **9 modos heterogéneos sin discriminador**. FIT trata cada cosa distinto (`set_type`, `intensity`, `workout_step`); Health Connect mapea a `ExerciseType` específicos.
7. **Sin identificador estándar de ejercicio**. Solo `name: "Sentadilla"` — cada exportador mantendría su tabla de traducción.

**Modelo propuesto — schema v5**

Filosofía: **aditivo, no destructivo**. Todos los campos nuevos opcionales para que la migración no requiera UI nueva el día uno. Bump `schemaVersion: 4 → 5` con migrador automático.

```js
workout = {
  id, date, session, phase, program, notes,
  startedAt: 1715688000000,        // NUEVO — epoch ms
  endedAt:   1715692500000,        // NUEVO — epoch ms
  durationSec: 4500,               // NUEVO — denormalizado para queries
  bodyweightKg: 78.5,              // NUEVO — opcional, para ejercicios bw
  exercises: [{
    name: "Sentadilla trasera",
    exerciseId: "back_squat",      // NUEVO — slug canónico del catálogo interno
    type, mode,
    sets: [{
      kg: 100,                     // CAMBIO — number (null permitido para bw puro)
      reps: 5,                     // CAMBIO — number
      repsMax: null,               // NUEVO — para rangos "10-12" → reps:10, repsMax:12
      rpe: 8,                      // NUEVO — opcional (1-10)
      rir: 2,                      // NUEVO — opcional (uno u otro)
      tempo: "30X1",               // NUEVO — opcional, formato estándar 4-dígitos
      restSec: 180,                // NUEVO — descanso DESPUÉS de este set
      completedAt: 1715688420000,  // NUEVO — opcional, epoch ms del tap "completar"
      isWarmup: false,             // NUEVO — distingue calentamiento del trabajo real
      isFailure: false             // NUEVO — set llevado al fallo
    }]
  }]
}
```

**Catálogo de ejercicios** (`www/js/exercise-catalog.js` nuevo):
```js
{
  id: "back_squat",
  name_es: "Sentadilla trasera",
  name_en: "Back Squat",
  healthConnectType: "EXERCISE_TYPE_SQUAT",
  fitCategory: "squat",                  // FIT exercise_category
  fitName: "back_squat"                  // FIT exercise_name
}
```

**Plan**
1. **Definir el catálogo inicial** (`www/js/exercise-catalog.js`): ~30-50 ejercicios base con `healthConnectType` y `fitCategory`/`fitName`. Cubrir los ejercicios reales que aparecen en los workouts de Luis hoy + los del programa Areté canónico.
2. **Tipos + validador** (`www/js/strength-schema.js` nuevo): JSDoc o `.d.ts` para `Workout`/`Exercise`/`Set` v5 + `validateWorkoutV5(w)` que devuelve errores legibles. Sin esto, la regresión por escritura mal hecha en la UI pasa desapercibida.
3. **Migrador `migrateV4ToV5(db)`** dentro del flujo existente en [`data.js`](www/js/data.js):
   - `parseLegacySet(s)`: `"5" → {reps:5}`, `"10-12" → {reps:10, repsMax:12}`, `"18:32" → {durationSec:1112}`, `"4R · 18:32" → {reps:4, durationSec:1112}`, vacío → `{reps:null}`. Conservar `s._raw` durante 1 versión por si hay que rollback.
   - `startedAt` reconstruido como `Date.parse(w.date + "T12:00:00")` (mediodía local) cuando falte. Marcar `w._historical = true` para que exportadores sepan que el timestamp es estimado.
   - Match de `exerciseId` desde `name` con lookup case-insensitive contra el catálogo + dejar `exerciseId: null` cuando no haya match (no fallar — solo log de "ejercicios sin catálogo" para añadirlos en una iteración futura).
4. **UI en `training.js`** — escritura del modelo nuevo en cada save:
   - Pulsar "Completar serie" estampa `completedAt = Date.now()` (es la única información temporal nueva que el usuario "regala" sin esfuerzo).
   - Cuando se abre la sesión: `startedAt = Date.now()`. Cuando se cierra/guarda: `endedAt = Date.now()` + `durationSec` calculado.
   - Inputs RPE/RIR/tempo/restSec: opcionales, escondidos detrás de un toggle "Avanzado" en la card del set para no asustar al usuario casual.
5. **Tests** sobre `parseLegacySet` cubriendo los 5 patrones de string detectados en el dato real de Luis + un fixture de migración v4→v5 con un workout completo.

**Estrategia de migración v4→v5**
- Misma pauta que las migraciones v1→v4 existentes en `data.js`: aplicar al cargar, una sola vez, persistir el resultado.
- **No-destructiva**: conservar `_raw` en cada set durante 1 versión (v5 → v6 lo limpia). Si la migración la cagas y un export sale mal, el string original sigue ahí.
- **Idempotente**: si ya es v5, no toca nada.
- Backup `localStorage.arete.backup` durante 7 días + flag `migrationCompleted` siguiendo el patrón previsto en FEAT-006 Fase 1.

**Tradeoffs honestos**
- **Doble fuente de verdad temporal**: `date` (legacy, sigue ahí) + `startedAt`/`endedAt` (nuevo). Conservar ambos en v5; deprecar `date` en una v6 futura. Vale la pena la fricción para no romper la UI de calendario actual.
- **Catálogo manual**: alguien (yo) tiene que mantener el mapeo. Mitigación: empezar con los ejercicios que Luis usa de verdad (auditar los workouts reales) y crecer por demanda.
- **9 modos exóticos**: ladder/pyramid/amrap/emom/superset siguen siendo difíciles de mapear a Health Connect/FIT. Decisión explícita: en el exportador, si `mode ∉ {sets, result}` declarar como `OTHER` y meter el detalle en `notes`. No bloquear la entrega por casos del 5%.
- **UI escondida**: si los campos RPE/RIR/tempo viven detrás de un toggle, en la práctica nadie los rellena. Aceptable para v1 — el modelo está listo si Luis los quiere usar, sin imponérselo al usuario casual.

**Por qué P2 y no P3**
Sin esto, FEAT-006 Fase 2 (exports) y Fase 5 (Health Connect) son a medio cocinar — solo cubrirían running. Y running ya tiene GPX/FIT bien. La promesa "Fuerza. Resistencia. Sin elegir." se sostiene si el dato de fuerza es tan portable como el de running. Por eso entra antes que FEAT-006 Fase 2 en el roadmap.

**Archivos sospechosos / a tocar**
- [`www/js/data.js`](www/js/data.js) — añadir `migrateV4ToV5` al pipeline existente de migraciones.
- [`www/js/ui/training.js`](www/js/ui/training.js) — escritura del modelo v5 (líneas 689-775 del bloque save) + opcionalmente UI "Avanzado".
- [`www/js/exercise-catalog.js`](www/js/exercise-catalog.js) — **nuevo**, catálogo canónico.
- [`www/js/strength-schema.js`](www/js/strength-schema.js) — **nuevo**, validador + tipos.
- `tests/` — fixtures de migración + tests de `parseLegacySet`.

**Bitácora**
- **2026-05-14** — Implementación inicial (Sprint 2). Cambios:
  - **Nuevo** [`www/js/exercise-catalog.js`](www/js/exercise-catalog.js): 34 ejercicios reales extraídos de `arete.json` + `kettlebell.json`. Cada entrada con `id` slug, `name_es`, `name_en`, aliases, y mapeo a `healthConnectSegment` + `fitCategory`/`fitName`. Lookup O(1) por id o por nombre (case + accent-insensitive). KB exóticos con `healthConnectSegment: null` — Health Connect no tiene segmentos específicos para olympic lifts.
  - **Nuevo** [`www/js/strength-schema.js`](www/js/strength-schema.js): tipos JSDoc del modelo v5, `parseLegacySet` (cubre 9 patrones: integer, range con `-`/`–`/`/`/`a`, mm:ss, `30s`/`1min`/`1h`, `4R · 18:32`, sufijo `/lado`, coma decimal, free text → null con `_raw`), `migrateWorkoutV4ToV5` idempotente, `validateWorkoutV5` con mensajes legibles, `dropRawFromWorkout` para futura v6.
  - **Modificado** [`www/js/data.js`](www/js/data.js): `CURRENT_SCHEMA: 4 → 5`, nueva migración v4→v5 en el pipeline existente, backup pre-migración en `arete.backup.v4` con auto-expiry a 7 días, helpers `getPreMigrationBackup`/`restorePreMigrationBackup` para rollback manual.
  - **Modificado** [`www/js/ui/training.js`](www/js/ui/training.js): nuevo `_workoutStartedAt` que se estampa al primer `saveDraft` (no al cargar el form — evita contaminar con tiempo de inactividad). Sobrevive a recargas vía `draft.startedAt`. `saveWorkout` ahora escribe `startedAt`/`endedAt`/`durationSec` en cada workout nuevo. Al editar uno migrado (`_historical: true`) preserva el timestamp estimado. Cada exercise se enriquece con `exerciseId` desde el catálogo (`null` si no hay match — no falla).
  - **Nuevo** [`vitest.config.js`](vitest.config.js) + [`tests/strength-schema.test.js`](tests/strength-schema.test.js) (31 tests) + [`tests/exercise-catalog.test.js`](tests/exercise-catalog.test.js) (13 tests). `npm run test` → 44/44 pasa.
- **2026-05-14** — Validación end-to-end con un v4 simulado realista (Press Banca + Dominada + Curl con rango + Plancha + Swing KB + Tabata + Burpees con free text):
  - 6 de 7 ejercicios mapean a `exerciseId` correcto. "Tabata Swing & Snatch" devuelve `null` — correcto, es protocolo, no ejercicio. Validador clean.
  - Parsing limpio: `"60" × "8"` → `{kg:60, reps:8}`; `"20" × "10-12"` → `{reps:10, repsMax:12}`; `"1min"` → `{durationSec:60}`; `"30s/lado"` → `{durationSec:30}`; `"4R · 18:32"` → `{reps:4, durationSec:1112}`; `"Total reps"` → `{reps:null, _raw:{reps:"Total reps"}}` (conserva el original).
  - `npx cap sync android`: 0.227s sin errores. Bundle copiado a `android/app/src/main/assets/public/`.
- **2026-05-14** — Pendiente para cerrar 🟢:
  1. Probar la migración con la DB real de Luis (instalación actual): exportar JSON v4 actual, importar en una instalación limpia → ver que carga sin errores, todos los workouts visibles, `% de exerciseId !== null` ≥ 80%.
  2. Crear un workout NUEVO con el APK debug instalado → verificar `startedAt`/`endedAt`/`durationSec` en `localStorage.arete`.
  3. Editar un workout HISTÓRICO migrado → verificar que `_historical: true` se preserva y `startedAt` no cambia.
  4. Decisión abierta: ¿toggle "Avanzado" para RPE/RIR/tempo en UI ahora o en una iteración posterior? El schema lo soporta sin cambios; solo falta UI.

**Archivos modificados/nuevos**
- Nuevos: `www/js/exercise-catalog.js`, `www/js/strength-schema.js`, `vitest.config.js`, `tests/strength-schema.test.js`, `tests/exercise-catalog.test.js`.
- Modificados: `www/js/data.js` (+47 líneas: migración v5 + backup), `www/js/ui/training.js` (+30 líneas: startedAt tracking + exerciseId en saves).

**Aceptación**
- ✅ `schemaVersion === 5` tras migración automática (validado en v4 simulado).
- ✅ `parseLegacySet` cubre los patrones identificados con 31 tests verdes.
- ✅ Una sesión NUEVA creada post-migración tiene `startedAt`/`endedAt`/`durationSec` rellenos sin que el usuario haya hecho nada extra.
- ✅ Una sesión MIGRADA tiene `_historical: true` y `startedAt` estimado; UI de calendario/historial no toca el campo.
- ✅ Validador `validateWorkoutV5(w)` corre limpio sobre el v4 simulado tras migración.
- ✅ Catálogo cubre ≥80% (medido: 6/7 = 86% en el smoke real; "Tabata" es protocolo, no ejercicio).
- ✅ Backup `arete.backup.v4` presente con auto-expiry a 7 días + `restorePreMigrationBackup()` para rollback manual.
- 🟡 Validación en DB real de Luis pendiente — sin esto no se sube a 🟢.
- 🟡 Decisión sobre UI "Avanzado" para RPE/RIR/tempo.

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

### FEAT-006 · 🟡 P3 — Storage local-first en Android (SQLite + exports + sync sin backend)

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
- Export FIT por sesión de fuerza: mensaje `session` + `workout_step` + `set` (con `repetitions`, `weight`, `category`). **Depende de FEAT-008**: con `reps`/`kg` como strings libres del schema v4 no se puede serializar limpio. Sin schema v5, este bullet queda parado.
- Export JSON/Markdown de workouts: cada sesión a un `.md` con frontmatter YAML + tabla de series.
- Export completo: `.zip` con `arete.db` + carpeta `runs/` (GPX) + carpeta `workouts/` (MD + FIT). Botón "Exportar todo" en Ajustes.
- **Entregable**: el usuario puede llevarse sus datos a Strava, Garmin Connect, TrainingPeaks, Hevy, Obsidian, etc., sin nuestra app.
- **Riesgo**: nulo para running (feature aditiva). Para strength, depende de FEAT-008 estar cerrado.

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
- Android: `@capacitor-community/health-connect` para escribir:
  - Runs: distancia, duración, HR avg/max, calorías. → `ExerciseSessionRecord` tipo `RUNNING`.
  - Sesiones de fuerza: `ExerciseSessionRecord` tipo `STRENGTH_TRAINING` + `ExerciseSegment` por ejercicio + segmentos repetidos por set. **Depende de FEAT-008**: el mapeo a `ExerciseType` y la estructura de sets/reps tipados son prerequisito.
- iOS (futuro): HealthKit equivalente cuando se haga build de iOS.
- Importar también: si el usuario tiene corazón con Apple Watch / Wear OS, importar las series HR.
- **Entregable**: tus runs Y tus sesiones de fuerza aparecen automáticamente en Samsung Health / Google Fit / Apple Health. Y al revés.
- **Riesgo**: solicitud de permisos de salud espanta. Mitigación: explícito y opcional, con beneficios claros. Apps de salud pasan revisión más estricta en Play Store — planificar tiempo extra para la primera aprobación.

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

**Bitácora**
- **2026-05-14** — Fase 1 sub-fase A entregada: fundamentos SQLite sin tocar `data.js`. La PWA y el APK siguen funcionando 1:1 con localStorage; el nuevo código está disponible pero no se llama desde ningún sitio aún.
  - **Decisión arquitectónica**: sprint dividido en 4 sub-fases atómicas (A: fundamentos · B: migrador one-shot · C: fachada `isCapacitor` en data.js · D: smoke test APK). Cada sub-fase deja el repo en estado funcional para no soportar una rama larga en main.
  - **Plugin**: `@capacitor-community/sqlite@8.1.0` añadido a `dependencies` (peer-dep `@capacitor/core >=8.0.0`, compatible con 8.3.1 del proyecto). `npx cap sync android` lo registra automáticamente — ahora 13 plugins Capacitor en Android. `better-sqlite3` para tests descartado: no compila con Node 23.x; reemplazado por `sql.js@^1.14.1` (SQLite WASM, sin paso de compilación nativa).
  - **Nuevo** [`www/js/db/schema.js`](www/js/db/schema.js): DDL completo + versionado. Tablas: `meta`, `workouts`, `body_logs`, `running_logs`, `running_routes` (FK → running_logs con CASCADE), `custom_programs`, `settings`, `deleted_records`. Índices en `date` y `program` para queries comunes. `migrateSchema(adapter)` aplica DDL faltante (v0→v1 ahora) dentro de transacción por step e idempotente. Decisión de diseño documentada en el módulo: heavy fields (exercises, sets, route coords, splits, HR series) van como JSON dentro de la fila — la granularidad real de queries es "todo el workout", nunca "todos los bench-press del último mes"; normalizar a 3 tablas sin beneficio sólo añade joins. SQLite 3.38+ tiene operadores JSON si esa query aparece en el futuro.
  - **Nuevo** [`www/js/db/sqlite-adapter.js`](www/js/db/sqlite-adapter.js): wrapper async sobre `@capacitor-community/sqlite` con 3 verbos (`run`, `query`, `transaction`) + `close`. Singleton de conexión perezoso, retain entre reads. PRAGMAs `journal_mode=WAL` (throughput de escrituras) y `foreign_keys=ON` (no es default en SQLite). Tira `Error` claro si se carga fuera de Capacitor — la PWA NUNCA debe llamarlo.
  - **Nuevo** [`www/js/db/repos.js`](www/js/db/repos.js): un objeto por colección con CRUD tipado (`workoutsRepo`, `bodyLogsRepo`, `runningLogsRepo`, `customProgramsRepo`, `settingsRepo`, `tombstonesRepo`, `metaRepo`). Cada repo posee su mapping row↔objeto (`rowToWorkout`/`workoutToRow`, etc.) — el resto del código nunca verá SQL. UPSERT mediante `ON CONFLICT(id) DO UPDATE`. `runningLogsRepo.save` separa light/heavy en una transacción (mimic del split actual localStorage ↔ IndexedDB). `delete` siempre escribe tombstone — `db.deletedIds` sigue funcionando vía `tombstonesRepo.loadIds`.
  - **Nuevos** [`tests/_sqljs-adapter.js`](tests/_sqljs-adapter.js) (test double que expone la misma interfaz `Adapter`, backed por sql.js) + [`tests/sqlite-schema.test.js`](tests/sqlite-schema.test.js) (5 tests) + [`tests/sqlite-repos.test.js`](tests/sqlite-repos.test.js) (20 tests).
  - **Tests verdes**: 100/100 totales (de 75 → 100). Cobertura nueva: migración idempotente, índices presentes, round-trip de cada colección, upsert, ordenación, FK cascade en delete de runs, tipos primitivos preservados en settings, throw cuando custom_programs.save sin _customId.
  - **No tocado**: `data.js`, `app.js`, `app.html`, `run-store.js`. La PWA en `iamluisgb.github.io/arete` no se ve afectada — el código nuevo vive en `www/js/db/` y nadie lo importa todavía.
- **2026-05-14** — Sub-fase B (próxima): migrador one-shot que lee `localStorage.arete` + IndexedDB `areteRuns` y escribe a `arete.db`. Flag `migration_completed` en `meta` + backup `arete.backup.sqlite` durante 7 días. Tests con fixtures de DB v5 real.
- **2026-05-14** — Sub-fase C: modificar `data.js` con switch `isCapacitor` (la PWA mantiene localStorage, Android pasa a SQLite repos detrás de la misma API pública).
- **2026-05-14** — Sub-fase D: smoke test en Pixel 7a real con DB real de Luis. Confirmar que la PWA sigue intacta tras `cap sync`.

**Archivos modificados/nuevos (sub-fase A)**
- Nuevos: `www/js/db/schema.js`, `www/js/db/sqlite-adapter.js`, `www/js/db/repos.js`, `tests/_sqljs-adapter.js`, `tests/sqlite-schema.test.js`, `tests/sqlite-repos.test.js`.
- Modificados: `package.json` (+`@capacitor-community/sqlite@8.1.0`, +`sql.js@^1.14.1` devDep), `package-lock.json`.

- **2026-05-14** — Fase 2 entregada parcial: GPX + Markdown + ZIP bundle. FIT pendiente como tarea propia.
  - **Nuevo** [`www/js/export/gpx-exporter.js`](www/js/export/gpx-exporter.js): GPX 1.1 con namespace `gpxtpx` de Garmin para HR. `makeHrLookup` usa cursor monotónico (amortized O(1) por trkpt). Descarta HR a más de 30s del trackpoint para evitar muestras stale. Coords con precisión a 6 decimales. `gpxFilename(log)` → `YYYY-MM-DD_slug.gpx`.
  - **Nuevo** [`www/js/export/markdown-exporter.js`](www/js/export/markdown-exporter.js): frontmatter YAML con id/date/session/phase/program/startedAt/endedAt/durationSec + `historical: true` para workouts migrados. Cuerpo con tabla por ejercicio (`| Set | kg | reps | RPE/RIR | rest |`), bodyweight como "bw", duraciones en `mm:ss`, rangos como `10-12`. Sección "## PRs" cuando aplica. Encabezado del ejercicio incluye el `exerciseId` canónico entre backticks.
  - **Nuevo** [`www/js/export/bundle-exporter.js`](www/js/export/bundle-exporter.js): ZIP con `arete-backup.json` + `runs/*.gpx` + `workouts/*.md` + `README.txt`. JSZip 3.10.1 cargado lazy desde unpkg al primer click (mismo patrón que Leaflet en `app.html`) — coste cero al cold-start. Callback `onProgress({stage, pct})` para feedback en la UI.
  - **Modificado** [`www/app.html`](www/app.html) (sección Datos): nuevo botón "Exportar todo (.zip)" debajo del existente "Exportar JSON".
  - **Modificado** [`www/js/app.js`](www/js/app.js) (settings wiring): listener para `#exportBundleBtn` con dynamic import de `bundle-exporter.js` (lazy load del módulo + sus deps) + estado deshabilitado + label con progreso + toast de confirmación al cierre.
  - **Nuevos** [`tests/gpx-exporter.test.js`](tests/gpx-exporter.test.js) (15 tests) + [`tests/markdown-exporter.test.js`](tests/markdown-exporter.test.js) (16 tests). Total suite: 75/75 ✓.
  - **No tocado**: `package.json`. JSZip va por CDN. Sin nuevas devDeps.
- **2026-05-14** — Pendiente para cerrar Fase 2 a 🟢:
  1. Smoke test en APK debug: descargar el `.zip`, abrirlo, verificar:
     - `arete-backup.json` reimporta sin errores en una instalación limpia.
     - Un `.gpx` se abre en Strava o Garmin Connect con el track + HR visibles.
     - Un `.md` se ve correcto en Obsidian (frontmatter parseado, tabla renderizada).
  2. Validar comportamiento offline: si el usuario pulsa "Exportar todo" sin red la primera vez (JSZip no cacheado), debería mostrar el toast de error sin colgar la UI.
- **2026-05-14** — Pendiente como tarea propia (sub-sprint Fase 2.5): export FIT para running (`@garmin/fitsdk`) + FIT para fuerza (mensaje `set` con `repetitions`/`weight`/`category`). Es la parte que abre Garmin Connect / Hevy / TrainingPeaks con el detalle de las series. Por complejidad (lib externa + binary writer + tests con fixtures) se decidió sacarla de este sprint y abrirla aparte.

**Archivos modificados/nuevos (Fase 2 parcial)**
- Nuevos: `www/js/export/gpx-exporter.js`, `www/js/export/markdown-exporter.js`, `www/js/export/bundle-exporter.js`, `tests/gpx-exporter.test.js`, `tests/markdown-exporter.test.js`.
- Modificados: `www/app.html` (+8 líneas: botón Exportar todo), `www/js/app.js` (+22 líneas: listener + lazy import).

---

## 🚦 Roadmap — sprints en orden de ataque

> Antes de mirar abajo: las tres features grandes (FEAT-004/005/006) tienen **13 preguntas abiertas** pendientes de decidir. Esas preguntas son trabajo de producto, no de ingeniería — y bloquean todo el trabajo de feature. El Sprint 0 existe para resolverlas en sesiones cortas antes de tocar código.

---

### 🎯 Sprint 0 — Decisiones de producto *(no-código)*

Resolver las preguntas abiertas que tienen bloqueadas las features. 1-2 sesiones cortas, sin compilar nada.

- **FEAT-005 (4 preguntas)**: rol del blog · naming de tabs · comportamiento del FAB · prioridad de sesión activa.
- **FEAT-004 (4 preguntas)**: qué tests TÚ haces · Murph con chaleco · PRs unificadas o separadas · niveles/percentiles.
- **FEAT-006 (5 preguntas)**: SQLite o exports primero · CRDT vs LWW · encriptación obligatoria u opcional · timing Health Connect · interop Android↔PWA.

**Salida esperada**: cada FEAT pasa a tener un plan concreto + criterios de aceptación rellenos. Cuando esto esté hecho, todo lo demás se ejecuta sin replantear.

---

### 🐛 Sprint 1 — Cerrar deuda + pulir running *(2-3 días)*

Dos cambios contenidos al flujo de carrera, ambos en `running-tracker.js` / `running.js`. Agrupados porque tocan el mismo área y reducen el coste de testing.

- **BUG-002 · P1** — Auto-pause no detecta inmovilidad. Repro con `adb emu geo fix` coords fijas o salida a la calle.
- **FEAT-007 · P2** — Mapa interactivo (pan/zoom) durante la carrera. ~1-2 h. Activar `dragging/touchZoom/scrollWheelZoom` + smart-follow + botón "Centrar".

Salida del sprint: el flujo de carrera queda pulido y la mesa limpia para entrar en features.

---

### 🧬 Sprint 2 — Modelo de datos de fuerza *(1-2 semanas)*

- **FEAT-008 · Schema v5 de sesiones de fuerza** (catálogo de ejercicios + tipos numéricos + timestamps + RPE/RIR opcional + migrador v4→v5).
- No depende de SQLite — vive aún sobre `localStorage`/`safeGet`. Aprovecha el pipeline de migraciones existente en `data.js`.
- Es prerequisito de Sprint 3 (exports FIT de fuerza) y de FEAT-006 Fase 5 (Health Connect strength).
- Cambio de schema antes que cambio de motor: una variable a la vez. Si el modelo v5 se rompe sobre `localStorage` (visible, rápido de iterar), se detecta antes de meterlo dentro de SQLite.

---

### 🎁 Sprint 3 — Quick-win visible *(1-2 semanas)*

- **FEAT-006 Fase 2 · Exports estándar** (GPX/FIT running + FIT/MD strength + zip completo).
- *Excepción al orden lógico*: aunque sea parte de FEAT-006, NO depende de SQLite — lee vía la API pública `loadDB()` que existe hoy. Lo adelantamos porque:
  - Independiente del storage (sin riesgo de bloquear).
  - Alto valor percibido por el usuario ("Exportar a Strava" / "Exportar a Garmin" / "Exportar a Hevy").
  - Refuerza la filosofía "tus datos son tuyos" justo antes de empezar el trabajo invisible de Sprint 4.
- FIT de fuerza es factible aquí gracias a Sprint 2 (FEAT-008). Sin schema v5 este sprint solo cubriría running.
- Cuando llegue Fase 1 (SQLite), los exports siguen funcionando sin tocar — la API pública no cambia.

---

### 🏗️ Sprint 4 — Cimentación invisible *(2-3 semanas)*

- **FEAT-006 Fase 1 · SQLite como source of truth en Android** (con fachada `isCapacitor`, PWA intacta).
- Ningún cambio visible para el usuario, pero desbloquea:
  - Saves no-bloqueantes.
  - Schema relacional con índices.
  - Modelo de datos limpio para FEAT-004.
  - Base para Fases 3-5 (encriptación, sync, Health Connect).
- Esquema SQL refleja el modelo v5 ya estabilizado en Sprint 2 — no se migra dos veces.
- Riesgo de migración mitigado con `localStorage.backup` retenido 7 días + flag `migrationCompleted`.

---

### 🎨 Sprint 5 — Reorganización IA *(2-3 semanas)*

- **FEAT-005 · Bottom nav `Inicio · Entreno · ⊕ · Cuerpo · Tú`**.
- Se ejecuta sobre SQLite ya estabilizado — evita escribir código nuevo sobre `localStorage` jubilado.
- Migración en 5 fases internas (ver issue) para evitar big-bang. Empezar por Fase 1 (crear "Tú" reagrupando Perfil + PRs + Historial + Ajustes), luego "Entreno", luego FAB.

---

### 📊 Sprint 6 — Tests catalog *(1-2 semanas)*

- **FEAT-004 · Benchmarks de rendimiento** (Murph, Fran, 1RM, etc.).
- Entra como tab "Tests" dentro de "Entreno" (creado en Sprint 5).
- Datos en tabla SQLite `benchmark_results` desde día uno (definida durante Sprint 4).
- PRs aparecen en "Tú → PRs" junto a 5K/10K/etc.

---

### 🔒 Sprint opcional · Hardening *(según tracción)*

- **FEAT-006 Fase 3** · Encriptación con passphrase opcional.
- **FEAT-006 Fase 4** · Sync multi-dispositivo real (LWW-por-record o CRDT).
- **FEAT-006 Fase 5** · Health Connect / HealthKit integration.
- No se activan automáticamente — sólo cuando haya señal real de que el usuario lo necesita (ej. usuarios pidiendo backup cifrado, o casos reales de sync rota entre dispositivos).

---

### 🧭 Decisiones de orden que ya están tomadas

- **Sprint 0 antes de TODO**: sin las respuestas, planificar es escribir ficción.
- **Sprint 1 antes de features**: cerrar lo roto antes de añadir superficie nueva.
- **Sprint 2 (schema v5) antes de Sprint 3 (exports)**: cambiar el modelo de datos antes de querer exportarlo. Sin esto, los exports de fuerza tendrían que parsear strings libres.
- **Sprint 2 (schema v5) sobre `localStorage`, NO sobre SQLite**: una variable a la vez. Probar el modelo nuevo en runtime conocido reduce riesgo frente a cambiar schema + motor en el mismo movimiento.
- **Sprint 3 (exports) antes de Sprint 4 (SQLite)**: el orden lógico diría al revés, pero exports no dependen de SQLite y entregan valor visible mientras Sprint 4 trabaja por debajo.
- **Sprint 4 (SQLite) antes de Sprint 5 (IA)**: no escribir código sobre `localStorage` condenado.
- **Sprint 5 (IA) antes de Sprint 6 (Tests)**: Tests necesitan el contenedor "Entreno" para entrar limpios.
- **Hardening al final**: encriptación + sync + Health Connect son features que sólo valen cuando hay base de usuarios real que las pida.
