package com.arete.app;

import android.os.Bundle;
import android.webkit.WebView;
import com.arete.app.location.LocationPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocationPlugin.class);
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.getSettings().setTextZoom(100);
            webView.getSettings().setUseWideViewPort(true);
        }
    }
}
