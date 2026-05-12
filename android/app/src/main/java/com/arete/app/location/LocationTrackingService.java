package com.arete.app.location;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import com.arete.app.MainActivity;
import com.arete.app.R;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

public class LocationTrackingService extends Service {
    public static final String ACTION_START = "com.arete.app.location.START";
    public static final String ACTION_STOP = "com.arete.app.location.STOP";
    public static final String ACTION_LOCATION_UPDATE = "com.arete.app.LOCATION_UPDATE";
    public static final String EXTRA_LOCATION_JSON = "location_json";

    public static final String PREFS_NAME = "arete_locations";
    public static final String PREFS_KEY_BUFFER = "buffer";

    private static final String TAG = "AreteLocSvc";
    private static final String CHANNEL_ID = "arete_run_tracking";
    private static final int NOTIFICATION_ID = 1042;

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopTracking();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!startInForeground()) {
            return START_NOT_STICKY;
        }
        startTracking();
        return START_STICKY;
    }

    private boolean startInForeground() {
        Notification notification = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            return true;
        } catch (SecurityException e) {
            // Android 14+ throws SecurityException if FGS type=location is started
            // before ACCESS_FINE_LOCATION is granted at runtime. Stop the service
            // cleanly instead of letting the exception kill the app.
            Log.w(TAG, "startForeground denied — location permission missing", e);
            stopSelf();
            return false;
        } catch (Throwable t) {
            Log.e(TAG, "startForeground failed", t);
            stopSelf();
            return false;
        }
    }

    private Notification buildNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Areté · Carrera activa")
            .setContentText("Registrando GPS en segundo plano")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Carrera",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Notificación persistente durante el tracking GPS");
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private void startTracking() {
        acquireWakeLock();

        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 2000L)
            .setMinUpdateIntervalMillis(1000L)
            .setMinUpdateDistanceMeters(0f)
            .setWaitForAccurateLocation(false)
            .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                for (Location loc : result.getLocations()) {
                    handleLocation(loc);
                }
            }
        };

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
        } catch (SecurityException e) {
            // Permisos no concedidos: stop service
            stopSelf();
        }
    }

    private void stopTracking() {
        if (fusedClient != null && locationCallback != null) {
            fusedClient.removeLocationUpdates(locationCallback);
        }
        releaseWakeLock();
    }

    private void handleLocation(Location loc) {
        try {
            JSONObject json = new JSONObject();
            json.put("lat", loc.getLatitude());
            json.put("lng", loc.getLongitude());
            json.put("accuracy", loc.getAccuracy());
            json.put("speed", loc.hasSpeed() ? loc.getSpeed() : JSONObject.NULL);
            json.put("heading", loc.hasBearing() ? loc.getBearing() : JSONObject.NULL);
            json.put("altitude", loc.hasAltitude() ? loc.getAltitude() : JSONObject.NULL);
            json.put("timestamp", loc.getTime());

            persistLocation(json);

            Intent broadcast = new Intent(ACTION_LOCATION_UPDATE);
            broadcast.putExtra(EXTRA_LOCATION_JSON, json.toString());
            LocalBroadcastManager.getInstance(this).sendBroadcast(broadcast);
        } catch (Exception ignored) {}
    }

    private void persistLocation(JSONObject json) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String existing = prefs.getString(PREFS_KEY_BUFFER, "[]");
        try {
            JSONArray arr = new JSONArray(existing);
            arr.put(json);
            prefs.edit().putString(PREFS_KEY_BUFFER, arr.toString()).apply();
        } catch (Exception ignored) {}
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm == null) return;
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Arete::LocationTracking");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(6 * 60 * 60 * 1000L);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
    }

    @Override
    public void onDestroy() {
        stopTracking();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
