package com.arete.app;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private final int[] lastInsets = new int[]{0, 0, 0, 0};

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        webView.getSettings().setTextZoom(100);
        webView.getSettings().setUseWideViewPort(true);
        webView.addJavascriptInterface(new InsetsBridge(), "AndroidInsets");

        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            float density = v.getResources().getDisplayMetrics().density;
            synchronized (lastInsets) {
                lastInsets[0] = Math.round(bars.top / density);
                lastInsets[1] = Math.round(bars.bottom / density);
                lastInsets[2] = Math.round(bars.left / density);
                lastInsets[3] = Math.round(bars.right / density);
            }
            applyInsetsToWebView(webView);
            return windowInsets;
        });

        webView.post(() -> ViewCompat.requestApplyInsets(webView));
    }

    private void applyInsetsToWebView(WebView webView) {
        int top, bottom, left, right;
        synchronized (lastInsets) {
            top = lastInsets[0];
            bottom = lastInsets[1];
            left = lastInsets[2];
            right = lastInsets[3];
        }
        String js = String.format(
            Locale.US,
            "if (document.documentElement) {" +
            "  document.documentElement.style.setProperty('--sai-top','%dpx');" +
            "  document.documentElement.style.setProperty('--sai-bottom','%dpx');" +
            "  document.documentElement.style.setProperty('--sai-left','%dpx');" +
            "  document.documentElement.style.setProperty('--sai-right','%dpx');" +
            "}",
            top, bottom, left, right
        );
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    public class InsetsBridge {
        @JavascriptInterface
        public int getTop() { synchronized (lastInsets) { return lastInsets[0]; } }
        @JavascriptInterface
        public int getBottom() { synchronized (lastInsets) { return lastInsets[1]; } }
        @JavascriptInterface
        public int getLeft() { synchronized (lastInsets) { return lastInsets[2]; } }
        @JavascriptInterface
        public int getRight() { synchronized (lastInsets) { return lastInsets[3]; } }
    }
}
