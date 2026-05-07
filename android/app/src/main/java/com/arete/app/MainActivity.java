package com.arete.app;

import android.graphics.Insets;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowInsets;
import android.view.WindowMetrics;
import android.webkit.WebView;
import com.arete.app.location.LocationPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "AreteInset";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocationPlugin.class);
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        webView.getSettings().setTextZoom(100);
        webView.getSettings().setUseWideViewPort(true);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Capacitor 8's SystemBars plugin overwrites --safe-area-inset-* with
        // 0px on Android 16 + WebView < 140 (~1.5s after page load). Force-
        // write the real values multiple times to win the race and apply
        // after every Capacitor tick.
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        int[] delays = {300, 800, 1800, 3000, 5000};
        for (int d : delays) {
            webView.postDelayed(() -> injectSafeArea(webView), d);
        }
    }

    private void injectSafeArea(WebView webView) {
        try {
            WindowMetrics wm = getWindowManager().getCurrentWindowMetrics();
            WindowInsets wi = wm.getWindowInsets();
            Insets sys = wi.getInsets(
                WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
            );
            float density = getResources().getDisplayMetrics().density;
            int topDp = (int) (sys.top / density);
            int bottomDp = (int) (sys.bottom / density);
            int leftDp = (int) (sys.left / density);
            int rightDp = (int) (sys.right / density);
            Log.d(TAG, "Insets dp top=" + topDp + " bot=" + bottomDp + " l=" + leftDp + " r=" + rightDp);

            String script = String.format(
                java.util.Locale.US,
                "document.documentElement.style.setProperty('--safe-area-inset-top','%dpx');"
                    + "document.documentElement.style.setProperty('--safe-area-inset-right','%dpx');"
                    + "document.documentElement.style.setProperty('--safe-area-inset-bottom','%dpx');"
                    + "document.documentElement.style.setProperty('--safe-area-inset-left','%dpx');"
                    + "console.log('AreteInset applied top='+%d);",
                topDp, rightDp, bottomDp, leftDp, topDp
            );
            webView.evaluateJavascript(script, null);
        } catch (Throwable t) {
            Log.e(TAG, "applySafeArea failed", t);
        }
    }
}
