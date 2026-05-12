package com.arete.app.location;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "AreteLocation")
public class LocationPlugin extends Plugin {
    private BroadcastReceiver receiver;

    @Override
    public void load() {
        super.load();
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String json = intent.getStringExtra(LocationTrackingService.EXTRA_LOCATION_JSON);
                if (json == null) return;
                try {
                    JSObject data = new JSObject(json);
                    notifyListeners("locationUpdate", data);
                } catch (Exception ignored) {}
            }
        };
        LocalBroadcastManager.getInstance(getContext()).registerReceiver(
            receiver,
            new IntentFilter(LocationTrackingService.ACTION_LOCATION_UPDATE)
        );
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            try {
                LocalBroadcastManager.getInstance(getContext()).unregisterReceiver(receiver);
            } catch (Exception ignored) {}
            receiver = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        // Android 14+ requires ACCESS_FINE_LOCATION (or COARSE) to be granted at
        // runtime before a foreground service of type=location can call
        // startForeground(). Refusing here avoids the SecurityException that
        // would otherwise kill the app from inside the service.
        if (ctx.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                != android.content.pm.PackageManager.PERMISSION_GRANTED
            && ctx.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            call.reject("Location permission not granted");
            return;
        }
        Intent intent = new Intent(ctx, LocationTrackingService.class);
        intent.setAction(LocationTrackingService.ACTION_START);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent);
            } else {
                ctx.startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not start location service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent(ctx, LocationTrackingService.class);
        intent.setAction(LocationTrackingService.ACTION_STOP);
        try {
            ctx.startService(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not stop location service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getBufferedLocations(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(
            LocationTrackingService.PREFS_NAME, Context.MODE_PRIVATE
        );
        String existing = prefs.getString(LocationTrackingService.PREFS_KEY_BUFFER, "[]");
        try {
            JSONArray arr = new JSONArray(existing);
            JSArray out = new JSArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.getJSONObject(i);
                out.put(JSObject.fromJSONObject(item));
            }
            JSObject ret = new JSObject();
            ret.put("locations", out);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read buffer: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clearBuffer(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(
            LocationTrackingService.PREFS_NAME, Context.MODE_PRIVATE
        );
        prefs.edit().remove(LocationTrackingService.PREFS_KEY_BUFFER).apply();
        call.resolve();
    }
}
