package com.arete.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.getSettings().setTextZoom(100);
            webView.getSettings().setUseWideViewPort(true);

            ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                float density = v.getResources().getDisplayMetrics().density;
                int top = Math.round(bars.top / density);
                int bottom = Math.round(bars.bottom / density);
                int left = Math.round(bars.left / density);
                int right = Math.round(bars.right / density);
                String js = String.format(
                    "document.documentElement.style.setProperty('--sai-top','%dpx');" +
                    "document.documentElement.style.setProperty('--sai-bottom','%dpx');" +
                    "document.documentElement.style.setProperty('--sai-left','%dpx');" +
                    "document.documentElement.style.setProperty('--sai-right','%dpx');",
                    top, bottom, left, right
                );
                v.post(() -> webView.evaluateJavascript(js, null));
                return WindowInsetsCompat.CONSUMED;
            });
        }
    }
}
